//! Sync engine: the sync algorithm ([`run`]), the per-notebook state machine and
//! single-flight orchestration ([`engine`]), automatic scheduling with debounce and offline
//! retry ([`scheduler`]) and conflict copies in the working tree ([`conflicts`]).
//!
//! Everything here is plain Rust: the integration tests in `tests/` drive it against local
//! bare repositories without Tauri.

pub mod conflicts;
pub mod engine;
pub mod run;
pub mod scheduler;

pub use conflicts::{ConflictInfo, ConflictResolution, ResolvedConflict};
pub use engine::SyncEngine;
pub use run::{SyncContext, SyncReport, sync};
pub use scheduler::{AutoSyncConfig, SyncPlan, SyncScheduler, SyncSource, SyncTrigger};

use serde::{Deserialize, Serialize};
use specta::Type;

/// Sync status as shown in the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "state", content = "data", rename_all = "camelCase")]
pub enum SyncState {
    /// Nothing to do and no sync scheduled (also: notebook has no remote).
    Idle,
    /// Local changes exist; a debounced sync is scheduled.
    Pending,
    /// A sync is running right now.
    Syncing,
    /// Last sync finished and local == remote.
    UpToDate,
    /// Remote unreachable; changes are committed locally and will be pushed later.
    Offline,
    /// Sync finished but produced conflict copies (relative paths within the notebook).
    Conflict(Vec<String>),
    /// Sync failed with a user-facing message.
    Error(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_tagged_union() {
        let json = serde_json::to_value(SyncState::Conflict(vec!["a.md".into()])).expect("json");
        assert_eq!(json["state"], "conflict");
        assert_eq!(json["data"][0], "a.md");

        let json = serde_json::to_value(SyncState::Idle).expect("json");
        assert_eq!(json["state"], "idle");

        let back: SyncState = serde_json::from_value(json).expect("roundtrip");
        assert_eq!(back, SyncState::Idle);
    }
}
