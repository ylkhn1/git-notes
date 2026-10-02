//! Two "devices" (working clones) syncing through a local bare repository, exercising the
//! full algorithm without Tauri: clean merges, conflict copies, deletes vs edits, an empty
//! remote, offline → online and recovery from odd repository states.

#![allow(clippy::unwrap_used)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use git_notes_lib::git::{self, Author, Credentials, HostKeyStore, NoCredentials};
use git_notes_lib::sync::{self, SyncContext, SyncReport, SyncState};

fn bare_remote(dir: &Path) -> PathBuf {
    let path = dir.join("remote.git");
    let mut options = git2::RepositoryInitOptions::new();
    options.bare(true).initial_head("main");
    git2::Repository::init_opts(&path, &options).expect("bare remote");
    path
}

struct Device {
    name: String,
    root: PathBuf,
}

impl Device {
    /// A device that cloned the remote.
    fn clone(dir: &Path, name: &str, remote: &Path) -> Self {
        let root = dir.join(name);
        git::remote::clone(
            remote.to_str().unwrap(),
            &root,
            &Credentials::None,
            &HostKeyStore::in_memory(),
            &mut |_| {},
        )
        .expect("clone");
        Self {
            name: name.to_owned(),
            root,
        }
    }

    /// A device that started from an empty local notebook and pointed it at the remote.
    fn init_with_remote(dir: &Path, name: &str, remote: &Path) -> Self {
        let root = dir.join(name);
        std::fs::create_dir_all(&root).unwrap();
        let repo = git::init(&root).unwrap();
        git::remote::set_remote_url(&repo, remote.to_str().unwrap()).unwrap();
        Self {
            name: name.to_owned(),
            root,
        }
    }

    fn ctx(&self) -> SyncContext {
        SyncContext {
            author: Author {
                name: format!("User on {}", self.name),
                email: format!("{}@example.com", self.name),
            },
            device: self.name.clone(),
            credentials: Arc::new(NoCredentials),
            hosts: Arc::new(HostKeyStore::in_memory()),
        }
    }

    fn sync(&self) -> SyncReport {
        sync::sync(&self.root, &self.ctx())
    }

    fn write(&self, rel: &str, text: &str) {
        let path = self.root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).unwrap_or_else(|_| panic!("{rel} missing"))
    }

    fn exists(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }

    fn delete(&self, rel: &str) {
        std::fs::remove_file(self.root.join(rel)).unwrap();
    }

    /// Markdown files, sorted, relative to the root.
    fn files(&self) -> Vec<String> {
        let mut out = Vec::new();
        collect(&self.root, &self.root, &mut out);
        out.sort();
        out
    }

    fn conflict_copies(&self) -> Vec<String> {
        self.files()
            .into_iter()
            .filter(|f| f.contains("(conflict "))
            .collect()
    }

    fn repo(&self) -> git2::Repository {
        git::open(&self.root).unwrap()
    }

    fn status(&self) -> git::RepoStatus {
        git::status::status(&self.root).unwrap()
    }
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<String>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.file_name().is_some_and(|n| n == ".git") {
            continue;
        }
        if path.is_dir() {
            collect(root, &path, out);
        } else {
            out.push(
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
}

fn up_to_date(report: &SyncReport) {
    assert_eq!(report.state, SyncState::UpToDate, "{report:?}");
}

#[test]
fn empty_remote_then_second_device_joins() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());

    let a = Device::clone(dir.path(), "laptop", &remote);
    // Nothing to do yet: empty notebook, empty remote.
    let report = a.sync();
    up_to_date(&report);
    assert!(!report.pushed);

    a.write("Welcome.md", "# Hello\n");
    let report = a.sync();
    up_to_date(&report);
    assert_eq!(report.committed_files, 1);
    assert!(report.pushed);
    let status = a.status();
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!((status.ahead, status.behind, status.dirty_files), (0, 0, 0));
    assert_eq!(
        status.last_commit.unwrap().summary,
        "sync: 1 file from laptop"
    );

    // Second device joins by cloning…
    let b = Device::clone(dir.path(), "phone", &remote);
    assert_eq!(b.read("Welcome.md"), "# Hello\n");
    assert_eq!(b.status().branch.as_deref(), Some("main"));

    // …or by pointing an empty local notebook at the remote (first sync checks it out).
    let c = Device::init_with_remote(dir.path(), "tablet", &remote);
    let report = c.sync();
    up_to_date(&report);
    assert!(report.pulled);
    assert_eq!(c.read("Welcome.md"), "# Hello\n");
    assert_eq!(c.status().branch.as_deref(), Some("main"));
}

#[test]
fn non_overlapping_edits_merge_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = Device::clone(dir.path(), "a", &remote);
    let lines: String = (1..=20).map(|i| format!("line {i}\n")).collect();
    a.write("shared.md", &lines);
    a.write("a-only.md", "A\n");
    up_to_date(&a.sync());
    let b = Device::clone(dir.path(), "b", &remote);

    // Different files plus different regions of the same file, edited concurrently.
    a.write(
        "shared.md",
        &lines.replace("line 2\n", "line 2 (edited on a)\n"),
    );
    a.write("a-only.md", "A2\n");
    b.write(
        "shared.md",
        &lines.replace("line 19\n", "line 19 (edited on b)\n"),
    );
    b.write("b-only.md", "B\n");

    up_to_date(&a.sync());
    let report = b.sync();
    up_to_date(&report);
    assert!(report.pulled && report.pushed, "{report:?}");
    assert!(report.conflicts.is_empty());

    let report = a.sync();
    up_to_date(&report);
    assert!(
        report.pulled && !report.pushed,
        "fast-forward only: {report:?}"
    );

    assert_eq!(a.files(), b.files());
    assert_eq!(a.files(), vec!["a-only.md", "b-only.md", "shared.md"]);
    let merged = a.read("shared.md");
    assert!(merged.contains("line 2 (edited on a)"));
    assert!(merged.contains("line 19 (edited on b)"));
    assert_eq!(a.read("shared.md"), b.read("shared.md"));
    assert!(a.conflict_copies().is_empty());

    // The rebase kept linear history: no merge commits anywhere.
    for d in [&a, &b] {
        let repo = d.repo();
        let mut walk = repo.revwalk().unwrap();
        walk.push_head().unwrap();
        for oid in walk {
            assert!(repo.find_commit(oid.unwrap()).unwrap().parent_count() <= 1);
        }
    }
}

#[test]
fn overlapping_edits_keep_both_versions() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = Device::clone(dir.path(), "desk", &remote);
    a.write("notes/plan.md", "# Plan\n\noriginal\n");
    up_to_date(&a.sync());
    let b = Device::clone(dir.path(), "pixel-8", &remote);

    a.write("notes/plan.md", "# Plan\n\nchanged on desk\n");
    b.write("notes/plan.md", "# Plan\n\nchanged on pixel\n");
    up_to_date(&a.sync());

    let report = b.sync();
    let SyncState::Conflict(copies) = &report.state else {
        panic!("expected a conflict, got {report:?}");
    };
    assert_eq!(copies.len(), 1);
    assert!(report.pushed, "the merge must be pushed: {report:?}");
    let copy = &copies[0];
    assert!(copy.starts_with("notes/plan (conflict pixel-8 "), "{copy}");
    assert!(copy.ends_with(").md"), "{copy}");
    assert_eq!(report.conflicts[0].original, "notes/plan.md");
    assert_eq!(&report.conflicts[0].copy, copy);

    // Theirs stays under the original name, ours lives in the copy.
    assert_eq!(b.read("notes/plan.md"), "# Plan\n\nchanged on desk\n");
    assert_eq!(b.read(copy), "# Plan\n\nchanged on pixel\n");
    assert_eq!(b.status().dirty_files, 0, "everything committed");

    // The other device receives both files via fast-forward.
    up_to_date(&a.sync());
    assert_eq!(a.files(), b.files());
    assert_eq!(a.read(copy), "# Plan\n\nchanged on pixel\n");

    // Once in sync, further syncs are no-ops.
    let report = b.sync();
    up_to_date(&report);
    assert!(!report.pulled && !report.pushed);
}

#[test]
fn delete_versus_edit_never_loses_text() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = Device::clone(dir.path(), "a", &remote);
    a.write("one.md", "one\n");
    a.write("two.md", "two\n");
    up_to_date(&a.sync());
    let b = Device::clone(dir.path(), "b", &remote);

    // Case 1: the delete reaches the remote first, the edit arrives second.
    a.delete("one.md");
    b.write("one.md", "one, edited on b\n");
    up_to_date(&a.sync());
    let report = b.sync();
    let SyncState::Conflict(copies) = &report.state else {
        panic!("expected a conflict copy, got {report:?}");
    };
    assert_eq!(copies.len(), 1);
    assert!(!b.exists("one.md"), "the delete wins for the original name");
    assert_eq!(b.read(&copies[0]), "one, edited on b\n");

    // Case 2: the edit reaches the remote first, the delete arrives second.
    up_to_date(&a.sync());
    b.write("two.md", "two, edited on b\n");
    a.delete("two.md");
    up_to_date(&b.sync());
    let report = a.sync();
    up_to_date(&report);
    assert!(report.conflicts.is_empty(), "{report:?}");
    assert_eq!(
        a.read("two.md"),
        "two, edited on b\n",
        "the remote edit is kept"
    );

    up_to_date(&b.sync());
    assert_eq!(a.files(), b.files());
}

#[test]
fn offline_then_online() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = Device::clone(dir.path(), "a", &remote);
    a.write("n.md", "v1\n");
    up_to_date(&a.sync());

    let hidden = dir.path().join("remote-hidden.git");
    std::fs::rename(&remote, &hidden).unwrap();
    a.write("n.md", "v2\n");
    let report = a.sync();
    assert_eq!(report.state, SyncState::Offline, "{report:?}");
    assert_eq!(
        report.committed_files, 1,
        "changes are committed even offline"
    );
    let status = a.status();
    assert_eq!(status.dirty_files, 0);
    assert_eq!(status.ahead, 1);

    std::fs::rename(&hidden, &remote).unwrap();
    let report = a.sync();
    up_to_date(&report);
    assert!(report.pushed);
    assert_eq!(a.status().ahead, 0);

    let b = Device::clone(dir.path(), "b", &remote);
    assert_eq!(b.read("n.md"), "v2\n");
}

#[test]
fn local_only_notebook_just_commits() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("local");
    std::fs::create_dir_all(&root).unwrap();
    git::init(&root).unwrap();
    let d = Device {
        name: "solo".into(),
        root,
    };
    d.write("a.md", "a\n");
    let report = d.sync();
    assert_eq!(report.state, SyncState::Idle);
    assert_eq!(report.committed_files, 1);
    assert!(!report.pushed);
    assert_eq!(d.status().dirty_files, 0);
    assert_eq!(d.status().remote_url, None);
}

#[test]
fn detached_head_is_reattached() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = Device::clone(dir.path(), "a", &remote);
    a.write("a.md", "1\n");
    up_to_date(&a.sync());

    {
        let repo = a.repo();
        let head = repo.head().unwrap().target().unwrap();
        repo.set_head_detached(head).unwrap();
    }
    assert!(a.status().detached);
    a.write("a.md", "2\n");
    let report = a.sync();
    up_to_date(&report);
    assert!(report.pushed);
    let status = a.status();
    assert!(!status.detached);
    assert_eq!(status.branch.as_deref(), Some("main"));

    let b = Device::clone(dir.path(), "b", &remote);
    assert_eq!(b.read("a.md"), "2\n");
}

#[test]
fn interrupted_merge_is_cleaned_up() {
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = Device::clone(dir.path(), "a", &remote);
    a.write("a.md", "1\n");
    up_to_date(&a.sync());
    let b = Device::clone(dir.path(), "b", &remote);
    a.write("a.md", "2\n");
    up_to_date(&a.sync());

    // Simulate a crash in the middle of a merge on b: fetch, start merging, never commit.
    {
        let repo = b.repo();
        git::remote::fetch(&repo, &Credentials::None, &HostKeyStore::in_memory()).unwrap();
        let upstream = repo
            .find_reference("refs/remotes/origin/main")
            .unwrap()
            .target()
            .unwrap();
        let annotated = repo.find_annotated_commit(upstream).unwrap();
        repo.merge(&[&annotated], None, None).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Merge);
    }
    assert_eq!(b.status().in_progress.as_deref(), Some("merge"));

    let report = b.sync();
    up_to_date(&report);
    assert_eq!(b.read("a.md"), "2\n");
    assert_eq!(b.status().in_progress, None);
}

#[test]
fn unrelated_local_history_merges_into_existing_remote() {
    // A user created notes locally, then pointed the notebook at a remote that already has
    // content from another device: both histories must survive.
    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = Device::clone(dir.path(), "a", &remote);
    a.write("from-a.md", "a\n");
    up_to_date(&a.sync());

    let b = Device::init_with_remote(dir.path(), "b", &remote);
    b.write("from-b.md", "b\n");
    let report = b.sync();
    up_to_date(&report);
    assert!(report.pulled && report.pushed, "{report:?}");
    assert_eq!(b.files(), vec!["from-a.md", "from-b.md"]);

    up_to_date(&a.sync());
    assert_eq!(a.files(), b.files());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn engine_runs_one_sync_per_notebook_at_a_time() {
    use git_notes_lib::git::CredentialProvider;
    use git_notes_lib::sync::SyncEngine;
    use std::sync::Mutex;

    #[derive(Debug)]
    struct Slow;
    impl CredentialProvider for Slow {
        fn credentials_for(
            &self,
            _url: &str,
        ) -> Result<Credentials, git_notes_lib::error::AppError> {
            std::thread::sleep(std::time::Duration::from_millis(400));
            Ok(Credentials::None)
        }
    }

    let dir = tempfile::tempdir().unwrap();
    let remote = bare_remote(dir.path());
    let a = Device::clone(dir.path(), "a", &remote);
    a.write("a.md", "1\n");

    let seen: Arc<Mutex<Vec<(String, SyncState)>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let engine = Arc::new(SyncEngine::new(Box::new(move |id, state| {
        sink.lock().unwrap().push((id.to_owned(), state.clone()));
    })));
    let ctx = || SyncContext {
        credentials: Arc::new(Slow),
        ..a.ctx()
    };

    let first = engine.sync("nb", a.root.clone(), ctx());
    let second = async {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        engine.sync("nb", a.root.clone(), ctx()).await
    };
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.state, SyncState::UpToDate, "{first:?}");
    assert!(first.pushed);
    assert_eq!(
        second.state,
        SyncState::Syncing,
        "second call is rejected while the first runs"
    );
    assert!(!second.pushed);

    assert_eq!(engine.state("nb"), SyncState::UpToDate);
    assert_eq!(engine.state("other"), SyncState::Idle);
    let states: Vec<SyncState> = seen
        .lock()
        .unwrap()
        .iter()
        .map(|(_, s)| s.clone())
        .collect();
    assert_eq!(states, vec![SyncState::Syncing, SyncState::UpToDate]);
}
