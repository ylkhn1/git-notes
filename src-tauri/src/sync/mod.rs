//! Sync engine: debounce, state machine and conflict handling. Implemented in Phases 2–3.
//!
//! The [`SyncState`] contract is defined up front because the UI is built against it.

use serde::Serialize;
use specta::Type;

/// Sync status as shown in the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "state", content = "data", rename_all = "camelCase")]
pub enum SyncState {
    /// Nothing to do and no sync scheduled.
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
    }
}
