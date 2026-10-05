//! The auto-sync scheduler driving two devices through a local bare remote: debounced syncs
//! after edits, focus/resume pulls, the offline queue with backoff, and conflict copies
//! surfacing in the working tree and being resolved.

#![allow(clippy::unwrap_used)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use git_notes_lib::git::{self, Author, Credentials, HostKeyStore, NoCredentials};
use git_notes_lib::sync::{
    AutoSyncConfig, ConflictResolution, SyncContext, SyncEngine, SyncPlan, SyncScheduler,
    SyncState, SyncTrigger, conflicts,
};

fn bare_remote(dir: &Path) -> PathBuf {
    let path = dir.join("remote.git");
    let mut options = git2::RepositoryInitOptions::new();
    options.bare(true).initial_head("main");
    git2::Repository::init_opts(&path, &options).expect("bare remote");
    path
}

fn clone_device(dir: &Path, name: &str, remote: &Path) -> PathBuf {
    let root = dir.join(name);
    git::remote::clone(
        remote.to_str().unwrap(),
        &root,
        &Credentials::None,
        &HostKeyStore::in_memory(),
        &mut |_| {},
    )
    .expect("clone");
    root
}

fn context(device: &str) -> SyncContext {
    SyncContext {
        author: Author {
            name: format!("User on {device}"),
            email: format!("{device}@example.com"),
        },
        device: device.to_owned(),
        credentials: Arc::new(NoCredentials),
        hosts: Arc::new(HostKeyStore::in_memory()),
    }
}

type Log = Arc<Mutex<Vec<(String, SyncState)>>>;
type Plans = Arc<Mutex<Vec<(String, SyncPlan)>>>;

struct Harness {
    scheduler: Arc<SyncScheduler>,
    states: Log,
    plans: Plans,
}

/// Fast timings so the tests finish in well under a second of waiting per step.
fn fast_config() -> AutoSyncConfig {
    AutoSyncConfig {
        enabled: true,
        debounce: Duration::from_millis(150),
        focus_min_interval: Duration::from_millis(400),
        retry_backoff: vec![Duration::from_millis(200), Duration::from_millis(400)],
    }
}

/// A scheduler whose notebook ids are device names mapped onto `roots`.
fn harness(roots: &[(&str, PathBuf)], config: AutoSyncConfig) -> Harness {
    let states: Log = Arc::new(Mutex::new(Vec::new()));
    let plans: Plans = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&states);
    let engine = Arc::new(SyncEngine::new(Box::new(move |id, state| {
        sink.lock().unwrap().push((id.to_owned(), state.clone()));
    })));
    let roots: Vec<(String, PathBuf)> = roots
        .iter()
        .map(|(n, r)| ((*n).to_owned(), r.clone()))
        .collect();
    let source = move |id: &str| {
        roots
            .iter()
            .find(|(n, _)| n == id)
            .map(|(n, r)| (r.clone(), context(n)))
            .ok_or_else(|| git_notes_lib::error::AppError::not_found(format!("{id} unknown")))
    };
    let plan_sink = Arc::clone(&plans);
    let scheduler = Arc::new(SyncScheduler::new(
        engine,
        Arc::new(source),
        tokio::runtime::Handle::current(),
        config,
        Box::new(move |id, plan| {
            plan_sink
                .lock()
                .unwrap()
                .push((id.to_owned(), plan.clone()));
        }),
    ));
    Harness {
        scheduler,
        states,
        plans,
    }
}

impl Harness {
    fn state(&self, id: &str) -> SyncState {
        self.scheduler.engine().state(id)
    }

    fn states_of(&self, id: &str) -> Vec<SyncState> {
        self.states
            .lock()
            .unwrap()
            .iter()
            .filter(|(n, _)| n == id)
            .map(|(_, s)| s.clone())
            .collect()
    }

    /// Polls until `predicate` holds, failing after `timeout`.
    async fn wait_until(&self, what: &str, timeout: Duration, predicate: impl Fn() -> bool) {
        let start = Instant::now();
        while !predicate() {
            assert!(
                start.elapsed() < timeout,
                "timed out waiting for {what}; states: {:?}",
                self.states.lock().unwrap()
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    async fn wait_for_state(&self, id: &str, expected: &SyncState) {
        let wanted = expected.clone();
        let who = id.to_owned();
        self.wait_until(
            &format!("{id} to reach {expected:?}"),
            Duration::from_secs(10),
            || self.state(&who) == wanted,
        )
        .await;
    }

    /// Keeps asking for a focus sync (the scheduler throttles them) until `predicate` holds.
    async fn pull_until(&self, id: &str, what: &str, predicate: impl Fn() -> bool) {
        let start = Instant::now();
        while !predicate() {
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "timed out waiting for {what}; states: {:?}",
                self.states.lock().unwrap()
            );
            self.scheduler.request(id, SyncTrigger::Focus);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    fn sync_count(&self, id: &str) -> usize {
        self.states_of(id)
            .iter()
            .filter(|s| **s == SyncState::Syncing)
            .count()
    }
}

fn write(root: &Path, rel: &str, text: &str) {
    std::fs::write(root.join(rel), text).unwrap();
}

fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_else(|_| panic!("{rel} missing"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn edits_are_debounced_into_one_sync_and_focus_pulls_them() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = clone_device(dir.path(), "a", &remote);
    let b = clone_device(dir.path(), "b", &remote);
    let h = harness(&[("a", a.clone()), ("b", b.clone())], fast_config());

    // Three quick edits → Pending once → a single sync after the debounce.
    write(&a, "n.md", "1\n");
    h.scheduler.note_change("a");
    write(&a, "n.md", "12\n");
    h.scheduler.note_change("a");
    write(&a, "n.md", "123\n");
    h.scheduler.note_change("a");
    assert_eq!(h.state("a"), SyncState::Pending);
    assert!(h.scheduler.plan("a").next_attempt_ms.is_some());
    assert_eq!(h.scheduler.plan("a").trigger, Some(SyncTrigger::Edit));

    h.wait_for_state("a", &SyncState::UpToDate).await;
    assert_eq!(h.sync_count("a"), 1, "{:?}", h.states_of("a"));
    assert_eq!(h.scheduler.plan("a"), SyncPlan::default());
    assert_eq!(git::status::status(&a).unwrap().ahead, 0);

    // Device b gains focus: it pulls without having changed anything itself.
    h.scheduler.request("b", SyncTrigger::Focus);
    h.wait_for_state("b", &SyncState::UpToDate).await;
    assert_eq!(read(&b, "n.md"), "123\n");

    // A second focus right away is throttled.
    h.scheduler.request("b", SyncTrigger::Focus);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(h.sync_count("b"), 1);

    // The pull's own checkout looks like a change on b: the debounce fires, finds nothing
    // local to send and restores the previous state without a sync.
    h.scheduler.note_change("b");
    assert_eq!(h.state("b"), SyncState::Pending);
    h.wait_for_state("b", &SyncState::UpToDate).await;
    assert_eq!(h.sync_count("b"), 1, "{:?}", h.states_of("b"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn offline_edits_are_queued_and_retried_with_backoff() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = clone_device(dir.path(), "a", &remote);
    let h = harness(&[("a", a.clone())], fast_config());

    write(&a, "n.md", "v1\n");
    h.scheduler.note_change("a");
    h.wait_for_state("a", &SyncState::UpToDate).await;

    let hidden = dir.path().join("remote-hidden.git");
    std::fs::rename(&remote, &hidden).unwrap();
    write(&a, "n.md", "v2\n");
    h.scheduler.note_change("a");
    h.wait_for_state("a", &SyncState::Offline).await;
    let status = git::status::status(&a).unwrap();
    assert_eq!(status.dirty_files, 0, "committed locally while offline");
    assert_eq!(status.ahead, 1, "the queue is the unpushed commit");

    let plan = h.scheduler.plan("a");
    assert_eq!(plan.trigger, Some(SyncTrigger::Retry));
    assert_eq!(plan.retry_attempt, 1);
    assert!(plan.next_attempt_ms.is_some());

    // Still offline: the retry fails again and the backoff grows.
    h.wait_until("second offline attempt", Duration::from_secs(10), || {
        h.scheduler.plan("a").retry_attempt >= 2
    })
    .await;
    assert_eq!(h.state("a"), SyncState::Offline);
    let gap = {
        let plans = h.plans.lock().unwrap();
        let retries: Vec<i64> = plans
            .iter()
            .filter(|(_, p)| p.trigger == Some(SyncTrigger::Retry))
            .filter_map(|(_, p)| p.next_attempt_ms)
            .collect();
        retries
    };
    assert!(gap.len() >= 2, "{gap:?}");

    // Back online: the pending retry pushes the queued commit.
    std::fs::rename(&hidden, &remote).unwrap();
    h.wait_for_state("a", &SyncState::UpToDate).await;
    assert_eq!(git::status::status(&a).unwrap().ahead, 0);
    assert_eq!(h.scheduler.plan("a"), SyncPlan::default());

    let b = clone_device(dir.path(), "b", &remote);
    assert_eq!(read(&b, "n.md"), "v2\n");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disabling_auto_sync_drops_plans_but_keeps_manual_sync() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = clone_device(dir.path(), "a", &remote);
    let h = harness(&[("a", a.clone())], fast_config());

    write(&a, "n.md", "v1\n");
    h.scheduler.note_change("a");
    assert_eq!(h.state("a"), SyncState::Pending);
    h.scheduler.set_config(AutoSyncConfig {
        enabled: false,
        ..fast_config()
    });
    assert_eq!(h.state("a"), SyncState::Idle, "Pending is withdrawn");
    assert_eq!(h.scheduler.plan("a"), SyncPlan::default());
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(h.sync_count("a"), 0, "nothing ran: {:?}", h.states_of("a"));

    h.scheduler.note_change("a");
    h.scheduler.request("a", SyncTrigger::Focus);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(h.sync_count("a"), 0);
    assert_eq!(git::status::status(&a).unwrap().dirty_files, 1);

    let report = h.scheduler.sync_now("a").await.unwrap();
    assert_eq!(report.state, SyncState::UpToDate);
    assert!(report.pushed);
    assert_eq!(h.sync_count("a"), 1);

    assert!(h.scheduler.sync_now("nope").await.is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_stops_a_planned_sync() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = clone_device(dir.path(), "a", &remote);
    let h = harness(&[("a", a.clone())], fast_config());

    write(&a, "n.md", "v1\n");
    h.scheduler.note_change("a");
    h.scheduler.cancel("a");
    assert_eq!(h.scheduler.plan("a"), SyncPlan::default());
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(h.sync_count("a"), 0, "{:?}", h.states_of("a"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn conflict_copies_surface_on_both_devices_and_resolve() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = clone_device(dir.path(), "a", &remote);
    let b = clone_device(dir.path(), "b", &remote);
    let h = harness(&[("a", a.clone()), ("b", b.clone())], fast_config());

    write(&a, "plan.md", "# Plan\n\nline\n");
    h.scheduler.note_change("a");
    h.wait_for_state("a", &SyncState::UpToDate).await;
    h.scheduler.request("b", SyncTrigger::Focus);
    h.wait_for_state("b", &SyncState::UpToDate).await;

    // Both devices edit the same line; a syncs first, b's auto-sync merges with a copy.
    write(&a, "plan.md", "# Plan\n\nline from a\n");
    h.scheduler.note_change("a");
    h.wait_for_state("a", &SyncState::UpToDate).await;
    write(&b, "plan.md", "# Plan\n\nline from b\n");
    h.scheduler.note_change("b");
    h.wait_until("b to report a conflict", Duration::from_secs(10), || {
        matches!(h.state("b"), SyncState::Conflict(_))
    })
    .await;

    let found = conflicts::list(&b).unwrap();
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].original, "plan.md");
    assert_eq!(found[0].device, "b");
    assert!(found[0].original_exists);
    assert_eq!(read(&b, "plan.md"), "# Plan\n\nline from a\n");
    assert_eq!(read(&b, &found[0].copy), "# Plan\n\nline from b\n");

    let diff = conflicts::diff(&b, &found[0].copy).unwrap();
    assert_eq!(diff.hunks.len(), 1);
    assert!(diff.old_text.unwrap().contains("from a"));
    assert!(diff.new_text.unwrap().contains("from b"));

    // The copy was pushed, so a sees the same conflict after its next pull.
    h.pull_until("a", "a to pull the copy", || {
        conflicts::list(&a).map(|c| c.len()).unwrap_or(0) == 1
    })
    .await;

    // a resolves it by taking b's text; auto-sync commits and pushes the resolution.
    let copy = conflicts::list(&a).unwrap()[0].copy.clone();
    let resolved = conflicts::resolve(&a, &copy, ConflictResolution::UseCopy).unwrap();
    assert_eq!(resolved.kept, vec!["plan.md"]);
    assert_eq!(read(&a, "plan.md"), "# Plan\n\nline from b\n");
    assert!(conflicts::list(&a).unwrap().is_empty());
    h.scheduler.note_change("a");
    h.wait_for_state("a", &SyncState::UpToDate).await;

    h.pull_until("b", "b to pull the resolution", || {
        conflicts::list(&b).map(|c| c.is_empty()).unwrap_or(false)
    })
    .await;
    assert_eq!(read(&b, "plan.md"), "# Plan\n\nline from b\n");
}
