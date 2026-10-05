//! Automatic sync: debounce after edits, sync on focus/resume, a periodic pull while a
//! notebook is open, and an offline queue that retries with backoff.
//!
//! The "queue" is git itself: changes are committed locally by every attempt, so all the
//! scheduler has to remember is *when* to try pushing again. Running two syncs for one
//! notebook at once is impossible by construction ([`SyncEngine`] is single-flight). Plain
//! Rust + tokio, so `tests/` can drive it against local bare repositories without Tauri.

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;

use super::SyncState;
use super::engine::SyncEngine;
use super::run::{SyncContext, SyncReport};
use crate::error::AppResult;
use crate::git::time::LocalTime;

/// Resolves what a sync needs for a notebook id. The Tauri layer implements it over the
/// registry, settings and credentials; tests use a closure.
pub trait SyncSource: Send + Sync {
    fn prepare(&self, notebook_id: &str) -> AppResult<(PathBuf, SyncContext)>;
}

impl<F> SyncSource for F
where
    F: Fn(&str) -> AppResult<(PathBuf, SyncContext)> + Send + Sync,
{
    fn prepare(&self, notebook_id: &str) -> AppResult<(PathBuf, SyncContext)> {
        self(notebook_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoSyncConfig {
    /// Master switch for everything except manual syncs.
    pub enabled: bool,
    /// Quiet period after the last change before a sync starts.
    pub debounce: Duration,
    /// Focus/resume triggers are ignored this soon after the previous sync finished.
    pub focus_min_interval: Duration,
    /// Delays between retries while offline; the last one repeats.
    pub retry_backoff: Vec<Duration>,
    /// Sync on a fixed interval while a notebook is open, so changes made elsewhere arrive
    /// without a local edit or a focus change. `None` turns it off.
    pub periodic: Option<Duration>,
}

impl Default for AutoSyncConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            debounce: Duration::from_secs(30),
            focus_min_interval: Duration::from_secs(15),
            retry_backoff: [30, 60, 120, 300, 600, 900]
                .map(Duration::from_secs)
                .to_vec(),
            periodic: Some(Duration::from_secs(15 * 60)),
        }
    }
}

/// Why a sync runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SyncTrigger {
    /// The user asked for it.
    Manual,
    /// The app (re)gained focus or a notebook was opened.
    Focus,
    /// Files changed and the debounce elapsed.
    Edit,
    /// Retrying after an offline result.
    Retry,
    /// The periodic interval elapsed.
    Periodic,
}

/// What the scheduler will do next for a notebook, for the UI.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    /// When the next automatic sync is due, in ms since the Unix epoch.
    #[specta(type = Option<specta_typescript::Number>)]
    pub next_attempt_ms: Option<i64>,
    /// Why it will run (`Edit`, `Retry` or `Periodic`).
    pub trigger: Option<SyncTrigger>,
    /// Consecutive offline results so far; resets on the first success.
    pub retry_attempt: u32,
}

/// Called whenever a notebook's plan changes (the Tauri layer turns this into an event).
pub type PlanListener = Box<dyn Fn(&str, &SyncPlan) + Send + Sync>;

pub struct SyncScheduler {
    engine: Arc<SyncEngine>,
    source: Arc<dyn SyncSource>,
    runtime: tokio::runtime::Handle,
    config: Mutex<AutoSyncConfig>,
    notebooks: Mutex<HashMap<String, Entry>>,
    on_plan: PlanListener,
}

impl fmt::Debug for SyncScheduler {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SyncScheduler")
            .field("config", &self.config)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Debounce,
    Retry,
    Periodic,
}

impl Kind {
    fn trigger(self) -> SyncTrigger {
        match self {
            Self::Debounce => SyncTrigger::Edit,
            Self::Retry => SyncTrigger::Retry,
            Self::Periodic => SyncTrigger::Periodic,
        }
    }
}

#[derive(Debug, Default)]
struct Timer {
    /// Bumped on every (re)arm; a sleeping task only fires if its generation is still current.
    generation: u64,
    due: Option<(Instant, i64)>,
}

impl Timer {
    /// Drops the pending deadline; a sleeping task for it will find the generation stale.
    fn disarm(&mut self) {
        self.generation += 1;
        self.due = None;
    }
}

#[derive(Debug, Default)]
struct Entry {
    debounce: Timer,
    retry: Timer,
    periodic: Timer,
    retry_attempt: u32,
    last_finished: Option<Instant>,
    /// State to show again if a planned sync turns out to have nothing to do.
    settled: Option<SyncState>,
}

impl Entry {
    fn timer_mut(&mut self, kind: Kind) -> &mut Timer {
        match kind {
            Kind::Debounce => &mut self.debounce,
            Kind::Retry => &mut self.retry,
            Kind::Periodic => &mut self.periodic,
        }
    }

    fn plan(&self) -> SyncPlan {
        let next = [
            (self.debounce.due, SyncTrigger::Edit),
            (self.retry.due, SyncTrigger::Retry),
            (self.periodic.due, SyncTrigger::Periodic),
        ]
        .into_iter()
        .filter_map(|(due, trigger)| due.map(|(at, ms)| (at, ms, trigger)))
        .min_by_key(|(at, _, _)| *at);
        SyncPlan {
            next_attempt_ms: next.map(|(_, ms, _)| ms),
            trigger: next.map(|(_, _, trigger)| trigger),
            retry_attempt: self.retry_attempt,
        }
    }
}

/// How long a due sync waits when another run for the notebook is still in flight.
const BUSY_RETRY: Duration = Duration::from_secs(2);

impl SyncScheduler {
    pub fn new(
        engine: Arc<SyncEngine>,
        source: Arc<dyn SyncSource>,
        runtime: tokio::runtime::Handle,
        config: AutoSyncConfig,
        on_plan: PlanListener,
    ) -> Self {
        Self {
            engine,
            source,
            runtime,
            config: Mutex::new(config),
            notebooks: Mutex::new(HashMap::new()),
            on_plan,
        }
    }

    pub fn engine(&self) -> &Arc<SyncEngine> {
        &self.engine
    }

    pub fn config(&self) -> AutoSyncConfig {
        self.config
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Applies new settings. Disabling drops every planned sync and clears `Pending` states;
    /// otherwise the periodic timers are re-armed with the new interval.
    pub fn set_config(self: &Arc<Self>, config: AutoSyncConfig) {
        let enabled = config.enabled;
        *self.config.lock().unwrap_or_else(PoisonError::into_inner) = config;
        let ids: Vec<String> = self.lock().keys().cloned().collect();
        if enabled {
            for id in ids {
                self.arm_periodic(&id);
            }
            return;
        }
        for id in ids {
            let settled = {
                let mut map = self.lock();
                let Some(entry) = map.get_mut(&id) else {
                    continue;
                };
                for kind in [Kind::Debounce, Kind::Retry, Kind::Periodic] {
                    entry.timer_mut(kind).disarm();
                }
                entry.settled.take()
            };
            if self.engine.state(&id) == SyncState::Pending {
                self.engine
                    .set_state(&id, settled.unwrap_or(SyncState::Idle));
            }
            self.emit_plan(&id);
        }
    }

    pub fn plan(&self, notebook_id: &str) -> SyncPlan {
        self.lock()
            .get(notebook_id)
            .map(Entry::plan)
            .unwrap_or_default()
    }

    /// Files in the notebook changed: (re)start the debounce and show `Pending`.
    pub fn note_change(self: &Arc<Self>, notebook_id: &str) {
        let config = self.config();
        if !config.enabled {
            return;
        }
        let current = self.engine.state(notebook_id);
        {
            let mut map = self.lock();
            let entry = map.entry(notebook_id.to_owned()).or_default();
            if entry.settled.is_none()
                && !matches!(current, SyncState::Pending | SyncState::Syncing)
            {
                entry.settled = Some(current.clone());
            }
        }
        if current != SyncState::Syncing && current != SyncState::Pending {
            self.engine.set_state(notebook_id, SyncState::Pending);
        }
        self.arm(notebook_id, Kind::Debounce, config.debounce);
    }

    /// Sync in the background because the app gained focus, resumed or opened the notebook.
    /// Ignored when automatic sync is off or a sync finished a moment ago.
    pub fn request(self: &Arc<Self>, notebook_id: &str, trigger: SyncTrigger) {
        let config = self.config();
        if config.enabled {
            self.ensure_periodic(notebook_id, &config);
        }
        if trigger != SyncTrigger::Manual {
            if !config.enabled || self.engine.is_running(notebook_id) {
                return;
            }
            let recent = self.lock().get(notebook_id).is_some_and(|e| {
                e.last_finished
                    .is_some_and(|t| t.elapsed() < config.focus_min_interval)
            });
            if recent {
                return;
            }
        }
        let this = Arc::clone(self);
        let id = notebook_id.to_owned();
        self.runtime.spawn(async move {
            this.run(&id, trigger).await;
        });
    }

    /// Runs a sync right away and returns its report (the manual button).
    pub async fn sync_now(self: &Arc<Self>, notebook_id: &str) -> AppResult<SyncReport> {
        let (root, ctx) = self.source.prepare(notebook_id)?;
        let config = self.config();
        if config.enabled {
            self.ensure_periodic(notebook_id, &config);
        }
        Ok(self
            .run_prepared(notebook_id, root, ctx, SyncTrigger::Manual)
            .await)
    }

    /// Drops everything planned for a notebook (closed or forgotten).
    pub fn cancel(&self, notebook_id: &str) {
        let removed = self.lock().remove(notebook_id).is_some();
        if removed {
            self.emit_plan(notebook_id);
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Entry>> {
        self.notebooks
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn emit_plan(&self, notebook_id: &str) {
        let plan = self.plan(notebook_id);
        (self.on_plan)(notebook_id, &plan);
    }

    /// Arms the periodic timer for a notebook that has none yet (first contact with it).
    fn ensure_periodic(self: &Arc<Self>, notebook_id: &str, config: &AutoSyncConfig) {
        let Some(interval) = config.periodic else {
            return;
        };
        let armed = self
            .lock()
            .get(notebook_id)
            .is_some_and(|e| e.periodic.due.is_some());
        if !armed {
            self.arm(notebook_id, Kind::Periodic, interval);
        }
    }

    /// (Re)starts the periodic timer from now, or drops it when periodic sync is off.
    fn arm_periodic(self: &Arc<Self>, notebook_id: &str) {
        let config = self.config();
        match config.periodic {
            Some(interval) if config.enabled => self.arm(notebook_id, Kind::Periodic, interval),
            _ => self.disarm(notebook_id, Kind::Periodic),
        }
    }

    fn disarm(&self, notebook_id: &str, kind: Kind) {
        let changed = {
            let mut map = self.lock();
            match map.get_mut(notebook_id) {
                Some(entry) => {
                    let timer = entry.timer_mut(kind);
                    let was_due = timer.due.is_some();
                    timer.disarm();
                    was_due
                }
                None => false,
            }
        };
        if changed {
            self.emit_plan(notebook_id);
        }
    }

    fn arm(self: &Arc<Self>, notebook_id: &str, kind: Kind, delay: Duration) {
        let generation = {
            let mut map = self.lock();
            let timer = map
                .entry(notebook_id.to_owned())
                .or_default()
                .timer_mut(kind);
            timer.generation += 1;
            let at_ms = LocalTime::now()
                .unix_ms()
                .saturating_add(i64::try_from(delay.as_millis()).unwrap_or(i64::MAX));
            timer.due = Some((Instant::now() + delay, at_ms));
            timer.generation
        };
        self.emit_plan(notebook_id);

        let this = Arc::clone(self);
        let id = notebook_id.to_owned();
        self.runtime.spawn(async move {
            tokio::time::sleep(delay).await;
            if !this.fire(&id, kind, generation) {
                return;
            }
            if this.engine.is_running(&id) {
                this.arm(
                    &id,
                    kind,
                    BUSY_RETRY.min(delay.max(Duration::from_millis(10))),
                );
                return;
            }
            this.emit_plan(&id);
            this.run(&id, kind.trigger()).await;
        });
    }

    /// Clears the timer if it is still the current one; `false` when it was re-armed or
    /// cancelled while sleeping.
    fn fire(&self, notebook_id: &str, kind: Kind, generation: u64) -> bool {
        let mut map = self.lock();
        let Some(entry) = map.get_mut(notebook_id) else {
            return false;
        };
        let timer = entry.timer_mut(kind);
        if timer.generation != generation {
            return false;
        }
        timer.due = None;
        true
    }

    async fn run(self: &Arc<Self>, notebook_id: &str, trigger: SyncTrigger) -> Option<SyncReport> {
        let (root, ctx) = match self.source.prepare(notebook_id) {
            Ok(prepared) => prepared,
            Err(error) => {
                tracing::warn!(%error, notebook_id, "auto-sync: cannot prepare sync");
                return None;
            }
        };
        if trigger == SyncTrigger::Edit && !has_local_work(&root) {
            // The change was the previous sync's own checkout, or was undone: nothing to
            // send, so skip the network round trip and show the earlier state again.
            let settled = self
                .lock()
                .get_mut(notebook_id)
                .and_then(|e| e.settled.take());
            if self.engine.state(notebook_id) == SyncState::Pending {
                self.engine
                    .set_state(notebook_id, settled.unwrap_or(SyncState::Idle));
            }
            return None;
        }
        Some(self.run_prepared(notebook_id, root, ctx, trigger).await)
    }

    async fn run_prepared(
        self: &Arc<Self>,
        notebook_id: &str,
        root: PathBuf,
        ctx: SyncContext,
        trigger: SyncTrigger,
    ) -> SyncReport {
        tracing::debug!(notebook_id, ?trigger, "sync: starting");
        let report = self.engine.sync(notebook_id, root, ctx).await;
        if report.state == SyncState::Syncing {
            // Another run was already in flight; it does the bookkeeping when it finishes.
            return report;
        }
        self.after_run(notebook_id, &report);
        report
    }

    fn after_run(self: &Arc<Self>, notebook_id: &str, report: &SyncReport) {
        let config = self.config();
        let retry_in = {
            let mut map = self.lock();
            let entry = map.entry(notebook_id.to_owned()).or_default();
            entry.last_finished = Some(Instant::now());
            entry.settled = None;
            match &report.state {
                SyncState::Offline => {
                    let delay = backoff(&config, entry.retry_attempt);
                    entry.retry_attempt = entry.retry_attempt.saturating_add(1);
                    Some(delay)
                }
                // Auth failures and the like need the user; the next edit, focus or click
                // tries again, a retry timer would only repeat the same error. The periodic
                // sync still runs, so a fixed server comes back on its own.
                SyncState::Error(_) => {
                    entry.retry.disarm();
                    None
                }
                _ => {
                    entry.retry_attempt = 0;
                    entry.retry.disarm();
                    None
                }
            }
        };
        let offline = retry_in.is_some();
        match retry_in {
            Some(delay) if config.enabled => {
                tracing::info!(notebook_id, ?delay, "auto-sync: offline, will retry");
                self.arm(notebook_id, Kind::Retry, delay);
            }
            _ => self.emit_plan(notebook_id),
        }
        // While offline the retry timer is the one that matters; the periodic timer resumes
        // after the next run that reaches the remote.
        if offline {
            self.disarm(notebook_id, Kind::Periodic);
        } else {
            self.arm_periodic(notebook_id);
        }
    }
}

fn backoff(config: &AutoSyncConfig, attempt: u32) -> Duration {
    let index = usize::try_from(attempt).unwrap_or(usize::MAX);
    config
        .retry_backoff
        .get(index)
        .or(config.retry_backoff.last())
        .copied()
        .unwrap_or(Duration::from_secs(60))
}

/// Cheap local check before a debounced sync: anything to commit, push or repair?
fn has_local_work(root: &Path) -> bool {
    match crate::git::status::status(root) {
        Ok(status) => {
            status.is_repo
                && (status.dirty_files > 0
                    || status.ahead > 0
                    || status.detached
                    || status.in_progress.is_some())
        }
        // Let the sync itself surface the problem.
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_repeats_the_last_delay() {
        let config = AutoSyncConfig {
            retry_backoff: vec![Duration::from_secs(1), Duration::from_secs(5)],
            ..AutoSyncConfig::default()
        };
        assert_eq!(backoff(&config, 0), Duration::from_secs(1));
        assert_eq!(backoff(&config, 1), Duration::from_secs(5));
        assert_eq!(backoff(&config, 7), Duration::from_secs(5));
    }

    #[test]
    fn plan_picks_the_earliest_timer() {
        let now = Instant::now();
        let mut entry = Entry::default();
        assert_eq!(entry.plan(), SyncPlan::default());
        entry.retry.due = Some((now + Duration::from_secs(60), 60_000));
        entry.debounce.due = Some((now + Duration::from_secs(5), 5_000));
        entry.retry_attempt = 2;
        assert_eq!(
            entry.plan(),
            SyncPlan {
                next_attempt_ms: Some(5_000),
                trigger: Some(SyncTrigger::Edit),
                retry_attempt: 2,
            }
        );
        entry.debounce.due = None;
        assert_eq!(entry.plan().trigger, Some(SyncTrigger::Retry));
        entry.periodic.due = Some((now + Duration::from_secs(30), 30_000));
        assert_eq!(entry.plan().trigger, Some(SyncTrigger::Periodic));
        assert_eq!(entry.plan().next_attempt_ms, Some(30_000));
    }

    #[test]
    fn local_work_detection() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_local_work(dir.path()), "plain folder: nothing to sync");
        crate::git::init(dir.path()).unwrap();
        assert!(!has_local_work(dir.path()));
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        assert!(has_local_work(dir.path()));
    }
}
