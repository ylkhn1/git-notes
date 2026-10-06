//! Commit log and per-file diffs for the history view.

use std::path::Path;

use git2::{Commit, Delta, DiffOptions, Oid, Repository, Sort, Tree};
use serde::Serialize;
use specta::Type;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    /// First line of the message.
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    #[specta(type = specta_typescript::Number)]
    pub time_ms: i64,
    pub parent_count: u32,
}

pub fn commit_info(repo: &Repository, oid: Oid) -> AppResult<CommitInfo> {
    Ok(info_from(&repo.find_commit(oid)?))
}

fn info_from(commit: &Commit<'_>) -> CommitInfo {
    let author = commit.author();
    CommitInfo {
        id: commit.id().to_string(),
        short_id: commit.id().to_string()[..8].to_owned(),
        summary: commit.summary().ok().flatten().unwrap_or("").to_owned(),
        author_name: author.name().unwrap_or("").to_owned(),
        author_email: author.email().unwrap_or("").to_owned(),
        time_ms: commit.time().seconds().saturating_mul(1000),
        parent_count: u32::try_from(commit.parent_count()).unwrap_or(u32::MAX),
    }
}

/// Upper bound on commits walked while filtering by path, so huge histories stay responsive.
const MAX_WALK: usize = 20_000;

/// Newest-first commit list, optionally only commits that changed `path`.
pub fn log(repo: &Repository, path: Option<&str>, limit: usize) -> AppResult<Vec<CommitInfo>> {
    if repo.head().is_err() {
        return Ok(Vec::new());
    }
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let mut out = Vec::new();
    for (walked, oid) in walk.enumerate() {
        if walked >= MAX_WALK || out.len() >= limit {
            break;
        }
        let commit = repo.find_commit(oid?)?;
        if let Some(path) = path
            && !touches(&commit, path)?
        {
            continue;
        }
        out.push(info_from(&commit));
    }
    Ok(out)
}

/// A commit "touches" a path when its blob differs from the blob in *every* parent, which
/// hides merge commits that merely carried the change over.
fn touches(commit: &Commit<'_>, path: &str) -> AppResult<bool> {
    let own = blob_at(&commit.tree()?, path);
    if commit.parent_count() == 0 {
        return Ok(own.is_some());
    }
    for parent in commit.parents() {
        if blob_at(&parent.tree()?, path) == own {
            return Ok(false);
        }
    }
    Ok(true)
}

fn blob_at(tree: &Tree<'_>, path: &str) -> Option<Oid> {
    tree.get_path(Path::new(path)).ok().map(|entry| entry.id())
}

/// One commit in a note's history.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteCommit {
    pub commit: CommitInfo,
    /// The note's path in this commit; older than a rename it is the previous name.
    pub path: String,
    pub kind: ChangeKind,
}

/// Newest-first commits that changed one note, following renames (like `git log --follow`).
///
/// When a commit adds the tracked path and its first parent had the same content under
/// another name, the walk continues with that older name.
pub fn note_log(repo: &Repository, path: &str, limit: usize) -> AppResult<Vec<NoteCommit>> {
    if repo.head().is_err() {
        return Ok(Vec::new());
    }
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let mut current = path.to_owned();
    let mut out = Vec::new();
    for (walked, oid) in walk.enumerate() {
        if walked >= MAX_WALK || out.len() >= limit {
            break;
        }
        let commit = repo.find_commit(oid?)?;
        if !touches(&commit, &current)? {
            continue;
        }
        let own = blob_at(&commit.tree()?, &current);
        let first_parent = commit.parents().next();
        let in_parent = match &first_parent {
            Some(parent) => blob_at(&parent.tree()?, &current),
            None => None,
        };
        let (kind, older_name) = match (own, in_parent) {
            (None, _) => (ChangeKind::Deleted, None),
            (Some(_), Some(_)) => (ChangeKind::Modified, None),
            (Some(_), None) => match &first_parent {
                Some(parent) => match renamed_from(repo, parent, &commit, &current)? {
                    Some(old) => (ChangeKind::Renamed, Some(old)),
                    None => (ChangeKind::Added, None),
                },
                None => (ChangeKind::Added, None),
            },
        };
        out.push(NoteCommit {
            commit: info_from(&commit),
            path: current.clone(),
            kind,
        });
        if let Some(old) = older_name {
            current = old;
        }
    }
    Ok(out)
}

/// The old name of `path` when `commit` renamed it (relative to `parent`).
fn renamed_from(
    repo: &Repository,
    parent: &Commit<'_>,
    commit: &Commit<'_>,
    path: &str,
) -> AppResult<Option<String>> {
    let mut diff = repo.diff_tree_to_tree(Some(&parent.tree()?), Some(&commit.tree()?), None)?;
    diff.find_similar(None)?;
    Ok(diff
        .deltas()
        .find(|d| d.status() == Delta::Renamed && d.new_file().path() == Some(Path::new(path)))
        .map(|d| path_of(d.old_file().path())))
}

/// A file as stored in one commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    /// The commit has no file at that path.
    pub missing: bool,
    pub binary: bool,
    /// The text, unless missing or binary.
    pub text: Option<String>,
}

/// The tree of `oid` (or of `HEAD` when `None`), or of its first parent with `before`.
fn tree_for<'r>(
    repo: &'r Repository,
    oid: Option<Oid>,
    before: bool,
) -> AppResult<Option<Tree<'r>>> {
    let commit = match oid {
        Some(oid) => repo.find_commit(oid)?,
        None => match repo.head() {
            Ok(head) => head.peel_to_commit()?,
            Err(_) => return Ok(None),
        },
    };
    if before {
        return Ok(commit.parents().next().map(|p| p.tree()).transpose()?);
    }
    Ok(Some(commit.tree()?))
}

/// Raw bytes of `path` in commit `oid` (`HEAD` when `None`); `before` reads the first parent.
pub fn file_bytes(
    repo: &Repository,
    oid: Option<Oid>,
    path: &str,
    before: bool,
) -> AppResult<Option<Vec<u8>>> {
    let Some(tree) = tree_for(repo, oid, before)? else {
        return Ok(None);
    };
    Ok(blob_at(&tree, path).and_then(|id| read_blob(repo, id)))
}

/// `path` as stored in commit `oid` (`HEAD` when `None`); `before` reads the first parent.
pub fn file_version(
    repo: &Repository,
    oid: Option<Oid>,
    path: &str,
    before: bool,
) -> AppResult<FileVersion> {
    Ok(match file_bytes(repo, oid, path, before)? {
        None => FileVersion {
            missing: true,
            binary: false,
            text: None,
        },
        Some(bytes) if looks_binary(&bytes) => FileVersion {
            missing: false,
            binary: true,
            text: None,
        },
        Some(bytes) => FileVersion {
            missing: false,
            binary: false,
            text: Some(String::from_utf8_lossy(&bytes).into_owned()),
        },
    })
}

/// A file that was deleted in some commit and is not in the working tree any more.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeletedFile {
    pub path: String,
    /// The commit that deleted it; the content is in its first parent.
    pub commit: CommitInfo,
}

/// Newest-first deletions of files that do not exist now, one entry per path.
pub fn deleted_files(repo: &Repository, limit: usize) -> AppResult<Vec<DeletedFile>> {
    if repo.head().is_err() {
        return Ok(Vec::new());
    }
    let workdir = repo.workdir().map(Path::to_path_buf);
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (walked, oid) in walk.enumerate() {
        if walked >= MAX_WALK || out.len() >= limit {
            break;
        }
        let commit = repo.find_commit(oid?)?;
        // Merges only carry deletions over from one side; the side's own commit lists them.
        if commit.parent_count() != 1 {
            continue;
        }
        for file in commit_files(repo, commit.id())? {
            if file.kind != ChangeKind::Deleted || !seen.insert(file.path.clone()) {
                continue;
            }
            if workdir
                .as_ref()
                .is_some_and(|w| w.join(&file.path).exists())
            {
                continue;
            }
            out.push(DeletedFile {
                path: file.path,
                commit: info_from(&commit),
            });
        }
    }
    out.truncate(limit);
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Other,
}

impl From<Delta> for ChangeKind {
    fn from(delta: Delta) -> Self {
        match delta {
            Delta::Added | Delta::Copied => Self::Added,
            Delta::Deleted => Self::Deleted,
            Delta::Modified | Delta::Typechange => Self::Modified,
            Delta::Renamed => Self::Renamed,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub kind: ChangeKind,
}

/// Files changed by `oid` relative to its first parent (everything, for a root commit).
pub fn commit_files(repo: &Repository, oid: Oid) -> AppResult<Vec<ChangedFile>> {
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;
    let parent_tree = commit.parents().next().map(|p| p.tree()).transpose()?;
    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    diff.find_similar(None)?;
    Ok(diff
        .deltas()
        .map(|delta| {
            let new_path = path_of(delta.new_file().path());
            let old_path = path_of(delta.old_file().path());
            let kind = ChangeKind::from(delta.status());
            ChangedFile {
                path: if kind == ChangeKind::Deleted {
                    old_path.clone()
                } else {
                    new_path
                },
                old_path: (kind == ChangeKind::Renamed).then_some(old_path),
                kind,
            }
        })
        .collect())
}

fn path_of(path: Option<&Path>) -> String {
    path.map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Add,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    /// Line content without the trailing newline.
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    /// First line of this hunk in the old text (1-based) and how many old lines it covers.
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub kind: ChangeKind,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
    /// Full text before the commit (None when added or binary).
    pub old_text: Option<String>,
    /// Full text after the commit (None when deleted or binary).
    pub new_text: Option<String>,
}

/// How `path` changed in commit `oid` (compared with its first parent).
pub fn file_diff(repo: &Repository, oid: Oid, path: &str) -> AppResult<FileDiff> {
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;
    let parent_tree = commit.parents().next().map(|p| p.tree()).transpose()?;

    let mut options = DiffOptions::new();
    options.pathspec(path).disable_pathspec_match(true);
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))?;
    let Some(delta) = diff.deltas().next() else {
        return Err(AppError::not_found(format!(
            "{path} did not change in {}",
            &oid.to_string()[..8]
        )));
    };
    let kind = ChangeKind::from(delta.status());
    let old_bytes = read_blob(repo, delta.old_file().id());
    let new_bytes = read_blob(repo, delta.new_file().id());
    text_diff(path, kind, old_bytes, new_bytes)
}

/// How a renamed file changed in commit `oid`: `old_path` in the first parent against `path`.
pub fn renamed_file_diff(
    repo: &Repository,
    oid: Oid,
    old_path: &str,
    path: &str,
) -> AppResult<FileDiff> {
    let old_bytes = file_bytes(repo, Some(oid), old_path, true)?;
    let new_bytes = file_bytes(repo, Some(oid), path, false)?;
    text_diff(path, ChangeKind::Renamed, old_bytes, new_bytes)
}

/// Diff of two byte buffers (either may be absent) as the UI shows it.
///
/// Shared by the history view and the conflict resolver; `kind` is whatever the caller knows
/// about how the file changed.
pub fn text_diff(
    path: &str,
    kind: ChangeKind,
    old_bytes: Option<Vec<u8>>,
    new_bytes: Option<Vec<u8>>,
) -> AppResult<FileDiff> {
    let binary = old_bytes.as_deref().is_some_and(looks_binary)
        || new_bytes.as_deref().is_some_and(looks_binary);
    let hunks = if binary {
        Vec::new()
    } else {
        hunks_between(
            old_bytes.as_deref().unwrap_or_default(),
            new_bytes.as_deref().unwrap_or_default(),
        )?
    };
    let text = |bytes: Option<Vec<u8>>| {
        bytes
            .filter(|_| !binary)
            .map(|b| String::from_utf8_lossy(&b).into_owned())
    };
    Ok(FileDiff {
        path: path.to_owned(),
        kind,
        binary,
        hunks,
        old_text: text(old_bytes),
        new_text: text(new_bytes),
    })
}

fn hunks_between(old: &[u8], new: &[u8]) -> AppResult<Vec<DiffHunk>> {
    let mut options = DiffOptions::new();
    options.context_lines(3);
    let patch = git2::Patch::from_buffers(old, None, new, None, Some(&mut options))?;
    let mut hunks = Vec::with_capacity(patch.num_hunks());
    for h in 0..patch.num_hunks() {
        let (hunk, line_count) = patch.hunk(h)?;
        let mut lines = Vec::with_capacity(line_count);
        for l in 0..line_count {
            let line = patch.line_in_hunk(h, l)?;
            let kind = match line.origin() {
                '+' => LineKind::Add,
                '-' => LineKind::Delete,
                ' ' => LineKind::Context,
                _ => continue,
            };
            lines.push(DiffLine {
                kind,
                old_no: line.old_lineno(),
                new_no: line.new_lineno(),
                text: String::from_utf8_lossy(line.content())
                    .trim_end_matches(['\n', '\r'])
                    .to_owned(),
            });
        }
        hunks.push(DiffHunk {
            header: String::from_utf8_lossy(hunk.header()).trim_end().to_owned(),
            old_start: hunk.old_start(),
            old_lines: hunk.old_lines(),
            new_start: hunk.new_start(),
            new_lines: hunk.new_lines(),
            lines,
        });
    }
    Ok(hunks)
}

fn read_blob(repo: &Repository, id: Oid) -> Option<Vec<u8>> {
    if id.is_zero() {
        return None;
    }
    repo.find_blob(id).ok().map(|b| b.content().to_vec())
}

/// git's heuristic: a NUL byte in the first 8 KB means binary.
fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|&b| b == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::commit::{Author, commit_all_if_dirty};

    fn author() -> Author {
        Author {
            name: "T".into(),
            email: "t@x".into(),
        }
    }

    #[test]
    fn log_and_diff_follow_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let repo = crate::git::init(dir.path()).unwrap();
        assert!(log(&repo, None, 10).unwrap().is_empty());

        std::fs::write(dir.path().join("a.md"), "one\ntwo\n").unwrap();
        std::fs::write(dir.path().join("b.md"), "b\n").unwrap();
        commit_all_if_dirty(&repo, &author(), "d1").unwrap();
        std::fs::write(dir.path().join("b.md"), "b2\n").unwrap();
        commit_all_if_dirty(&repo, &author(), "d1").unwrap();
        std::fs::write(dir.path().join("a.md"), "one\nthree\n").unwrap();
        let (last, _) = commit_all_if_dirty(&repo, &author(), "d2")
            .unwrap()
            .unwrap();

        let all = log(&repo, None, 10).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].id, last.to_string());
        assert_eq!(all[0].summary, "sync: 1 file from d2");

        let only_a = log(&repo, Some("a.md"), 10).unwrap();
        assert_eq!(only_a.len(), 2);
        let only_b = log(&repo, Some("b.md"), 10).unwrap();
        assert_eq!(only_b.len(), 2);
        assert_eq!(log(&repo, Some("missing.md"), 10).unwrap().len(), 0);
        assert_eq!(log(&repo, None, 1).unwrap().len(), 1);

        let files = commit_files(&repo, last).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "a.md");
        assert_eq!(files[0].kind, ChangeKind::Modified);

        let diff = file_diff(&repo, last, "a.md").unwrap();
        assert_eq!(diff.kind, ChangeKind::Modified);
        assert!(!diff.binary);
        assert_eq!(diff.old_text.as_deref(), Some("one\ntwo\n"));
        assert_eq!(diff.new_text.as_deref(), Some("one\nthree\n"));
        assert_eq!(diff.hunks.len(), 1);
        assert_eq!(
            (diff.hunks[0].old_start, diff.hunks[0].old_lines),
            (1, 2),
            "{:?}",
            diff.hunks[0].header
        );
        assert_eq!((diff.hunks[0].new_start, diff.hunks[0].new_lines), (1, 2));
        let kinds: Vec<_> = diff.hunks[0]
            .lines
            .iter()
            .map(|l| (l.kind, l.text.as_str()))
            .collect();
        assert_eq!(
            kinds,
            vec![
                (LineKind::Context, "one"),
                (LineKind::Delete, "two"),
                (LineKind::Add, "three")
            ]
        );
        assert!(file_diff(&repo, last, "b.md").is_err());

        let first = all[2].id.parse().unwrap();
        let added = file_diff(&repo, first, "a.md").unwrap();
        assert_eq!(added.kind, ChangeKind::Added);
        assert_eq!(added.old_text, None);
    }

    #[test]
    fn text_diff_of_buffers_tracks_line_numbers() {
        let old = "a\nb\nc\nd\ne\nf\ng\nh\n";
        let new = "a\nb\nc\nd\nE\nf\ng\nh\ni\n";
        let diff = text_diff(
            "n.md",
            ChangeKind::Modified,
            Some(old.into()),
            Some(new.into()),
        )
        .unwrap();
        assert!(!diff.binary);
        assert_eq!(diff.hunks.len(), 1);
        let hunk = &diff.hunks[0];
        assert_eq!(hunk.old_start, 2);
        assert_eq!(hunk.new_start, 2);
        let changed: Vec<_> = hunk
            .lines
            .iter()
            .filter(|l| l.kind != LineKind::Context)
            .map(|l| (l.kind, l.old_no, l.new_no, l.text.as_str()))
            .collect();
        assert_eq!(
            changed,
            vec![
                (LineKind::Delete, Some(5), None, "e"),
                (LineKind::Add, None, Some(5), "E"),
                (LineKind::Add, None, Some(9), "i"),
            ]
        );
        assert!(
            text_diff(
                "n.md",
                ChangeKind::Modified,
                Some(b"same".to_vec()),
                Some(b"same".to_vec())
            )
            .unwrap()
            .hunks
            .is_empty()
        );
        let added = text_diff("n.md", ChangeKind::Added, None, Some(b"x\n".to_vec())).unwrap();
        assert_eq!(added.old_text, None);
        assert_eq!(added.hunks[0].lines[0].kind, LineKind::Add);
    }

    #[test]
    fn note_log_follows_renames() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let repo = crate::git::init(root).unwrap();
        std::fs::write(root.join("old.md"), "first version of the note\nline two\n").unwrap();
        commit_all_if_dirty(&repo, &author(), "d").unwrap();
        std::fs::write(root.join("old.md"), "first version of the note\nline 2\n").unwrap();
        commit_all_if_dirty(&repo, &author(), "d").unwrap();
        std::fs::create_dir(root.join("dir")).unwrap();
        std::fs::rename(root.join("old.md"), root.join("dir/new.md")).unwrap();
        commit_all_if_dirty(&repo, &author(), "d").unwrap();
        std::fs::write(
            root.join("dir/new.md"),
            "first version of the note\nline 2\nmore\n",
        )
        .unwrap();
        commit_all_if_dirty(&repo, &author(), "d").unwrap();

        let entries = note_log(&repo, "dir/new.md", 10).unwrap();
        let renamed = entries[1].commit.id.parse().unwrap();
        let diff = renamed_file_diff(&repo, renamed, "old.md", "dir/new.md").unwrap();
        assert_eq!(diff.kind, ChangeKind::Renamed);
        assert!(diff.hunks.is_empty());
        let seen: Vec<_> = entries.iter().map(|e| (e.path.as_str(), e.kind)).collect();
        assert_eq!(
            seen,
            vec![
                ("dir/new.md", ChangeKind::Modified),
                ("dir/new.md", ChangeKind::Renamed),
                ("old.md", ChangeKind::Modified),
                ("old.md", ChangeKind::Added),
            ]
        );
        assert_eq!(note_log(&repo, "dir/new.md", 2).unwrap().len(), 2);

        let first = entries[3].commit.id.parse().unwrap();
        let version = file_version(&repo, Some(first), "old.md", false).unwrap();
        assert_eq!(
            version.text.as_deref(),
            Some("first version of the note\nline two\n")
        );
        assert!(
            file_version(&repo, Some(first), "dir/new.md", false)
                .unwrap()
                .missing
        );
        let head = file_version(&repo, None, "dir/new.md", false).unwrap();
        assert_eq!(
            head.text.as_deref(),
            Some("first version of the note\nline 2\nmore\n")
        );
    }

    #[test]
    fn deleted_files_lists_only_files_that_are_gone() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let repo = crate::git::init(root).unwrap();
        for name in ["a.md", "b.md", "c.md"] {
            std::fs::write(root.join(name), format!("{name} content\n")).unwrap();
        }
        commit_all_if_dirty(&repo, &author(), "d").unwrap();
        std::fs::remove_file(root.join("a.md")).unwrap();
        std::fs::remove_file(root.join("b.md")).unwrap();
        let (deleting, _) = commit_all_if_dirty(&repo, &author(), "d").unwrap().unwrap();
        // b.md comes back uncommitted: it is not "deleted" any more.
        std::fs::write(root.join("b.md"), "again\n").unwrap();

        let deleted = deleted_files(&repo, 10).unwrap();
        assert_eq!(deleted.len(), 1);
        assert_eq!(deleted[0].path, "a.md");
        assert_eq!(deleted[0].commit.id, deleting.to_string());

        let bytes = file_bytes(&repo, Some(deleting), "a.md", true).unwrap();
        assert_eq!(bytes.as_deref(), Some(b"a.md content\n".as_slice()));
        assert_eq!(
            file_bytes(&repo, Some(deleting), "a.md", false).unwrap(),
            None
        );
    }

    #[test]
    fn binary_files_have_no_hunks() {
        let dir = tempfile::tempdir().unwrap();
        let repo = crate::git::init(dir.path()).unwrap();
        std::fs::write(
            dir.path().join("img.png"),
            [0x89, b'P', b'N', b'G', 0, 1, 2],
        )
        .unwrap();
        let (oid, _) = commit_all_if_dirty(&repo, &author(), "d").unwrap().unwrap();
        let diff = file_diff(&repo, oid, "img.png").unwrap();
        assert!(diff.binary);
        assert!(diff.hunks.is_empty());
        assert_eq!(diff.new_text, None);
    }
}
