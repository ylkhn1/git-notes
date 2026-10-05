//! Per-notebook sync state and single-flight execution.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use super::SyncState;
use super::run::{SyncContext, SyncReport, sync};

/// Called whenever a notebook's state changes (the Tauri layer turns this into an event).
pub type StateListener = Box<dyn Fn(&str, &SyncState) + Send + Sync>;

pub struct SyncEngine {
    states: Mutex<HashMap<String, SyncState>>,
    running: Arc<Mutex<HashSet<String>>>,
    listener: StateListener,
}

impl fmt::Debug for SyncEngine {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SyncEngine")
            .field("states", &self.states)
            .field("running", &self.running)
            .finish_non_exhaustive()
    }
}

impl SyncEngine {
    pub fn new(listener: StateListener) -> Self {
        Self {
            states: Mutex::new(HashMap::new()),
            running: Arc::new(Mutex::new(HashSet::new())),
            listener,
        }
    }

    /// Last known state; `Idle` for notebooks that never synced in this session.
    pub fn state(&self, notebook_id: &str) -> SyncState {
        self.states
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(notebook_id)
            .cloned()
            .unwrap_or(SyncState::Idle)
    }

    pub fn is_running(&self, notebook_id: &str) -> bool {
        self.running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(notebook_id)
    }

    /// Records a state that did not come from a sync run (e.g. `Pending` while a debounced
    /// sync is scheduled) and notifies the listener.
    pub fn set_state(&self, notebook_id: &str, state: SyncState) {
        self.states
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(notebook_id.to_owned(), state.clone());
        (self.listener)(notebook_id, &state);
    }

    /// Drops the remembered state of a notebook that was closed or forgotten.
    pub fn forget(&self, notebook_id: &str) {
        self.states
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(notebook_id);
    }

    /// Runs one sync for the notebook on a blocking thread.
    ///
    /// Single-flight: while a sync for the same notebook is running, further calls return a
    /// report with [`SyncState::Syncing`] immediately instead of starting another.
    pub async fn sync(
        self: &Arc<Self>,
        notebook_id: &str,
        root: PathBuf,
        ctx: SyncContext,
    ) -> SyncReport {
        let Some(_guard) = RunningGuard::acquire(&self.running, notebook_id) else {
            return SyncReport::with_state(SyncState::Syncing);
        };
        self.set_state(notebook_id, SyncState::Syncing);

        let result = tokio::task::spawn_blocking(move || sync(&root, &ctx)).await;
        let report = result.unwrap_or_else(|join_error| {
            SyncReport::with_state(SyncState::Error(format!("sync task failed: {join_error}")))
        });

        self.set_state(notebook_id, report.state.clone());
        report
    }
}

/// Marks a notebook as syncing for as long as it lives, so the mark is released even if the
/// future driving the sync is dropped.
struct RunningGuard {
    running: Arc<Mutex<HashSet<String>>>,
    notebook_id: String,
}

impl RunningGuard {
    fn acquire(running: &Arc<Mutex<HashSet<String>>>, notebook_id: &str) -> Option<Self> {
        running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(notebook_id.to_owned())
            .then(|| Self {
                running: Arc::clone(running),
                notebook_id: notebook_id.to_owned(),
            })
    }
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.notebook_id);
    }
}
