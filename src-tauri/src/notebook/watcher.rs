//! Debounced filesystem watcher for a notebook root.
//!
//! `notify` delivers raw events on its own thread; we coalesce them for a short window and
//! hand the affected notebook-relative paths to a callback. The Tauri layer turns that into
//! a `NotebookChanged` event; the sync engine (Phase 3) will use the same signal.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher as _};

use super::paths;
use crate::error::{AppError, AppResult};

/// How long to wait after the last raw event before reporting a batch.
pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// Running watcher; dropping it stops watching.
pub struct NotebookWatcher {
    _watcher: notify::RecommendedWatcher,
    stop: mpsc::Sender<()>,
}

impl std::fmt::Debug for NotebookWatcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NotebookWatcher").finish_non_exhaustive()
    }
}

impl NotebookWatcher {
    /// Starts watching `root` recursively. `on_change` receives deduplicated relative paths
    /// (`""` when the change could not be attributed to a specific entry).
    pub fn start<F>(root: &Path, on_change: F) -> AppResult<Self>
    where
        F: Fn(Vec<String>) + Send + 'static,
    {
        let root = root.to_path_buf();
        let (raw_tx, raw_rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let (stop, stop_rx) = mpsc::channel::<()>();

        let mut watcher = notify::recommended_watcher(move |event| {
            // The receiver is gone when the watcher is dropped; ignore send errors then.
            let _ = raw_tx.send(event);
        })
        .map_err(|e| AppError::internal(format!("cannot create watcher: {e}")))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| AppError::internal(format!("cannot watch {}: {e}", root.display())))?;

        thread::Builder::new()
            .name("notebook-watcher".into())
            .spawn(move || debounce_loop(&root, &raw_rx, &stop_rx, on_change))
            .map_err(|e| AppError::internal(format!("cannot spawn watcher thread: {e}")))?;

        Ok(Self {
            _watcher: watcher,
            stop,
        })
    }
}

impl Drop for NotebookWatcher {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

fn debounce_loop<F>(
    root: &Path,
    raw_rx: &mpsc::Receiver<notify::Result<notify::Event>>,
    stop_rx: &mpsc::Receiver<()>,
    on_change: F,
) where
    F: Fn(Vec<String>),
{
    let mut pending: BTreeSet<String> = BTreeSet::new();
    let mut deadline: Option<Instant> = None;
    loop {
        if stop_rx.try_recv().is_ok() {
            return;
        }
        let wait = deadline.map_or(Duration::from_millis(500), |d| {
            d.saturating_duration_since(Instant::now())
        });
        match raw_rx.recv_timeout(wait) {
            Ok(Ok(event)) => {
                if is_relevant(&event) {
                    for path in &event.paths {
                        pending.insert(relative(root, path));
                    }
                    deadline = Some(Instant::now() + DEBOUNCE);
                }
            }
            Ok(Err(error)) => tracing::warn!(%error, "watcher error"),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        if let Some(d) = deadline
            && Instant::now() >= d
        {
            deadline = None;
            if !pending.is_empty() {
                on_change(std::mem::take(&mut pending).into_iter().collect());
            }
        }
    }
}

fn is_relevant(event: &notify::Event) -> bool {
    use notify::EventKind::{Create, Modify, Remove};
    matches!(event.kind, Create(_) | Modify(_) | Remove(_))
        && !event.paths.iter().all(|p| is_ignored(p))
}

/// Our own atomic-write temp files and git internals are noise for the UI.
fn is_ignored(path: &Path) -> bool {
    path.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        name == ".git" || (name.starts_with('.') && name.ends_with(".tmp"))
    })
}

fn relative(root: &Path, path: &Path) -> String {
    paths::to_rel(root, path).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn reports_debounced_relative_paths() {
        let dir = tempfile::tempdir().unwrap();
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let _watcher = NotebookWatcher::start(dir.path(), move |paths| {
            sink.lock().unwrap().push(paths);
        })
        .unwrap();
        // Give the backend a moment to arm (inotify is immediate, but be safe on CI).
        thread::sleep(Duration::from_millis(200));

        std::fs::write(dir.path().join("a.md"), "1").unwrap();
        std::fs::write(dir.path().join("a.md"), "12").unwrap();
        std::fs::write(dir.path().join(".a.md.123.tmp"), "noise").unwrap();

        let start = Instant::now();
        while seen.lock().unwrap().is_empty() && start.elapsed() < Duration::from_secs(5) {
            thread::sleep(Duration::from_millis(50));
        }
        let batches = seen.lock().unwrap().clone();
        assert_eq!(
            batches.len(),
            1,
            "two writes within the window → one batch: {batches:?}"
        );
        assert_eq!(batches[0], vec!["a.md".to_owned()]);
    }

    #[test]
    fn ignores_git_and_temp_files() {
        assert!(is_ignored(Path::new("/nb/.git/index")));
        assert!(is_ignored(Path::new("/nb/.note.md.42.tmp")));
        assert!(!is_ignored(Path::new("/nb/.gitignore")));
        assert!(!is_ignored(Path::new("/nb/note.md")));
    }
}
