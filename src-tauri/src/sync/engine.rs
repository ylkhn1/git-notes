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
    running: Mutex<HashSet<String>>,
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
            running: Mutex::new(HashSet::new()),
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

    fn set(&self, notebook_id: &str, state: SyncState) {
        self.states
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(notebook_id.to_owned(), state.clone());
        (self.listener)(notebook_id, &state);
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
        {
            let mut running = self.running.lock().unwrap_or_else(PoisonError::into_inner);
            if !running.insert(notebook_id.to_owned()) {
                return SyncReport {
                    state: SyncState::Syncing,
                    committed_files: 0,
                    pushed: false,
                    pulled: false,
                    conflicts: Vec::new(),
                };
            }
        }
        self.set(notebook_id, SyncState::Syncing);

        let result = tokio::task::spawn_blocking(move || sync(&root, &ctx)).await;
        let report = result.unwrap_or_else(|join_error| SyncReport {
            state: SyncState::Error(format!("sync task failed: {join_error}")),
            committed_files: 0,
            pushed: false,
            pulled: false,
            conflicts: Vec::new(),
        });

        self.set(notebook_id, report.state.clone());
        self.running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(notebook_id);
        report
    }
}
