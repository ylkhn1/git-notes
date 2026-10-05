//! Integrating upstream commits: rebase first, merge with keep-both conflict handling second.
//!
//! The rule for anything the textual 3-way merge cannot resolve: the remote version keeps the
//! file's name, the local version is preserved next to it as
//! `note (conflict <device> <YYYY-MM-DD HHmm>).md`. Nothing is ever dropped.

use std::path::Path;

use git2::build::CheckoutBuilder;
use git2::{
    ErrorCode, IndexConflict, IndexEntry, MergeOptions, Oid, RebaseOptions, Repository, Signature,
};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, AppResult};

/// A file whose local version was preserved as a copy during a merge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCopy {
    /// The path that now holds the remote version (or was deleted remotely).
    pub original: String,
    /// Where the local version lives now.
    pub copy: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RebaseOutcome {
    Completed,
    /// A commit did not apply cleanly; the rebase was aborted and HEAD is unchanged.
    Conflicted,
}

/// Rebases HEAD's local commits onto `upstream`.
pub fn rebase_onto(
    repo: &Repository,
    upstream: Oid,
    signature: &Signature<'_>,
) -> AppResult<RebaseOutcome> {
    let onto = repo.find_annotated_commit(upstream)?;
    let mut options = RebaseOptions::new();
    options.inmemory(false);
    let mut rebase = repo.rebase(None, Some(&onto), None, Some(&mut options))?;
    loop {
        match rebase.next() {
            None => break,
            Some(Err(error)) => {
                let _ = rebase.abort();
                return Err(error.into());
            }
            Some(Ok(_operation)) => {}
        }
        if repo.index()?.has_conflicts() {
            rebase.abort()?;
            return Ok(RebaseOutcome::Conflicted);
        }
        match rebase.commit(None, signature, None) {
            Ok(_) => {}
            // The change is already upstream: nothing to commit for this step.
            Err(error) if error.code() == ErrorCode::Applied => {}
            Err(error) => {
                let _ = rebase.abort();
                return Err(error.into());
            }
        }
    }
    rebase.finish(Some(signature))?;
    Ok(RebaseOutcome::Completed)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeResult {
    pub commit: Oid,
    pub conflicts: Vec<ConflictCopy>,
}

/// Merges `upstream` into HEAD, keeping both versions of anything that conflicts, and commits.
pub fn merge_keep_both(
    repo: &Repository,
    upstream: Oid,
    signature: &Signature<'_>,
    device: &str,
    stamp: &str,
) -> AppResult<MergeResult> {
    let root = repo
        .workdir()
        .ok_or_else(|| AppError::internal("cannot merge in a bare repository"))?
        .to_path_buf();
    let head_commit = repo.head()?.peel_to_commit()?;
    let their_commit = repo.find_commit(upstream)?;
    let annotated = repo.find_annotated_commit(upstream)?;

    let mut checkout = CheckoutBuilder::new();
    checkout.safe().allow_conflicts(true);
    repo.merge(
        &[&annotated],
        Some(&mut MergeOptions::new()),
        Some(&mut checkout),
    )?;

    let mut index = repo.index()?;
    let conflicts = index.conflicts()?.collect::<Result<Vec<_>, _>>()?;
    let mut copies = Vec::new();
    for conflict in &conflicts {
        let resolution = resolve(repo, &root, conflict, device, stamp)?;
        for entry in [&conflict.ancestor, &conflict.our, &conflict.their]
            .into_iter()
            .flatten()
        {
            let _ = index.conflict_remove(Path::new(&entry_path(entry)));
        }
        for rel in &resolution.removes {
            let abs = root.join(rel);
            if abs.is_file() {
                std::fs::remove_file(&abs)?;
            }
            let _ = index.remove_path(Path::new(rel));
        }
        for (rel, bytes) in &resolution.writes {
            let abs = root.join(rel);
            if let Some(parent) = abs.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&abs, bytes)?;
            index.add_path(Path::new(rel))?;
        }
        copies.extend(resolution.copy);
    }
    index.write()?;
    let tree = repo.find_tree(index.write_tree()?)?;

    let commit = repo.commit(
        Some("HEAD"),
        signature,
        signature,
        &merge_message(device, &copies),
        &tree,
        &[&head_commit, &their_commit],
    )?;
    repo.cleanup_state()?;
    Ok(MergeResult {
        commit,
        conflicts: copies,
    })
}

fn merge_message(device: &str, copies: &[ConflictCopy]) -> String {
    if copies.is_empty() {
        return format!("merge: sync from {device}");
    }
    let mut message = format!(
        "merge: sync from {device} ({} conflict {} kept)\n\n",
        copies.len(),
        if copies.len() == 1 { "copy" } else { "copies" }
    );
    for copy in copies {
        message.push_str(&format!("{} -> {}\n", copy.original, copy.copy));
    }
    message
}

#[derive(Debug, Default)]
struct Resolution {
    writes: Vec<(String, Vec<u8>)>,
    removes: Vec<String>,
    copy: Option<ConflictCopy>,
}

fn resolve(
    repo: &Repository,
    root: &Path,
    conflict: &IndexConflict,
    device: &str,
    stamp: &str,
) -> AppResult<Resolution> {
    match (&conflict.our, &conflict.their) {
        (Some(our), Some(their)) => {
            let their_path = entry_path(their);
            let our_path = entry_path(our);
            // libgit2 already tried this during the merge; repeating it here makes the rule
            // explicit and lets a clean textual merge win if it does succeed.
            if let Some(ancestor) = &conflict.ancestor
                && let Ok(result) = repo.merge_file_from_index(ancestor, our, their, None)
                && result.is_automergeable()
            {
                return Ok(Resolution {
                    writes: vec![(their_path, result.content().to_vec())],
                    removes: if our_path == entry_path(their) {
                        vec![]
                    } else {
                        vec![our_path]
                    },
                    copy: None,
                });
            }
            let copy_path = unique_conflict_path(root, &our_path, device, stamp);
            Ok(Resolution {
                writes: vec![
                    (their_path.clone(), blob(repo, their)?),
                    (copy_path.clone(), blob(repo, our)?),
                ],
                removes: if our_path == their_path {
                    vec![]
                } else {
                    vec![our_path]
                },
                copy: Some(ConflictCopy {
                    original: their_path,
                    copy: copy_path,
                }),
            })
        }
        // Deleted here, changed there: the remote version wins and nothing of ours is lost.
        (None, Some(their)) => Ok(Resolution {
            writes: vec![(entry_path(their), blob(repo, their)?)],
            ..Resolution::default()
        }),
        // Changed here, deleted there: honour the delete but keep our text as a copy.
        (Some(our), None) => {
            let our_path = entry_path(our);
            let copy_path = unique_conflict_path(root, &our_path, device, stamp);
            Ok(Resolution {
                writes: vec![(copy_path.clone(), blob(repo, our)?)],
                removes: vec![our_path.clone()],
                copy: Some(ConflictCopy {
                    original: our_path,
                    copy: copy_path,
                }),
            })
        }
        (None, None) => Ok(Resolution {
            removes: conflict
                .ancestor
                .as_ref()
                .map(entry_path)
                .into_iter()
                .collect(),
            ..Resolution::default()
        }),
    }
}

fn entry_path(entry: &IndexEntry) -> String {
    String::from_utf8_lossy(&entry.path).into_owned()
}

fn blob(repo: &Repository, entry: &IndexEntry) -> AppResult<Vec<u8>> {
    Ok(repo.find_blob(entry.id)?.content().to_vec())
}

/// `dir/note.md` → `dir/note (conflict pixel-8 2026-10-02 1432).md`.
pub fn conflict_copy_path(path: &str, device: &str, stamp: &str) -> String {
    let (dir, file) = match path.rsplit_once('/') {
        Some((dir, file)) => (Some(dir), file),
        None => (None, path),
    };
    let (stem, ext) = match file.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, Some(ext)),
        _ => (file, None),
    };
    let mut name = format!("{stem} (conflict {device} {stamp})");
    if let Some(ext) = ext {
        name.push('.');
        name.push_str(ext);
    }
    match dir {
        Some(dir) => format!("{dir}/{name}"),
        None => name,
    }
}

/// The parts of a conflict copy's name, as produced by [`conflict_copy_path`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictName {
    /// Path the copy was made from (`dir/note.md`).
    pub original: String,
    pub device: String,
    /// `YYYY-MM-DD HHmm`, possibly followed by a disambiguating counter.
    pub stamp: String,
}

/// Inverse of [`conflict_copy_path`]: `None` for ordinary file names.
pub fn parse_conflict_copy(path: &str) -> Option<ConflictName> {
    let (dir, file) = match path.rsplit_once('/') {
        Some((dir, file)) => (Some(dir), file),
        None => (None, path),
    };
    let (stem, ext) = match file.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, Some(ext)),
        _ => (file, None),
    };
    let inner = stem.strip_suffix(')')?;
    let (base, marker) = inner.rsplit_once(" (conflict ")?;
    if base.is_empty() {
        return None;
    }
    // "<device> <YYYY-MM-DD> <HHmm>[ <n>]": the device name never contains spaces
    // (see `device::sanitize`), so everything after the first space is the stamp.
    let (device, stamp) = marker.split_once(' ')?;
    if device.is_empty() || !looks_like_stamp(stamp) {
        return None;
    }
    let mut original = base.to_owned();
    if let Some(ext) = ext {
        original.push('.');
        original.push_str(ext);
    }
    Some(ConflictName {
        original: match dir {
            Some(dir) => format!("{dir}/{original}"),
            None => original,
        },
        device: device.to_owned(),
        stamp: stamp.to_owned(),
    })
}

fn looks_like_stamp(stamp: &str) -> bool {
    let bytes = stamp.as_bytes();
    bytes.len() >= 15
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b' '
        && bytes[..15]
            .iter()
            .enumerate()
            .all(|(i, b)| matches!(i, 4 | 7 | 10) || b.is_ascii_digit())
        && bytes[15..].iter().all(|b| b.is_ascii_digit() || *b == b' ')
}

fn unique_conflict_path(root: &Path, path: &str, device: &str, stamp: &str) -> String {
    let base = conflict_copy_path(path, device, stamp);
    if !root.join(&base).exists() {
        return base;
    }
    for n in 2..1000 {
        let candidate = conflict_copy_path(path, device, &format!("{stamp} {n}"));
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    base
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_names() {
        assert_eq!(
            conflict_copy_path("note.md", "pixel-8", "2026-10-02 1432"),
            "note (conflict pixel-8 2026-10-02 1432).md"
        );
        assert_eq!(
            conflict_copy_path("work/plan.v2.md", "laptop", "2026-10-02 0900"),
            "work/plan.v2 (conflict laptop 2026-10-02 0900).md"
        );
        assert_eq!(
            conflict_copy_path("Makefile", "laptop", "s"),
            "Makefile (conflict laptop s)"
        );
        assert_eq!(
            conflict_copy_path(".hidden", "laptop", "s"),
            ".hidden (conflict laptop s)"
        );
    }

    #[test]
    fn conflict_names_round_trip() {
        for (path, device, stamp) in [
            ("note.md", "pixel-8", "2026-10-02 1432"),
            ("work/plan.v2.md", "laptop", "2026-10-02 0900"),
            ("Makefile", "laptop", "2026-01-31 2359"),
            ("a/b/c.md", "dev", "2026-10-02 1432 2"),
        ] {
            let copy = conflict_copy_path(path, device, stamp);
            let parsed = parse_conflict_copy(&copy).unwrap_or_else(|| panic!("{copy}"));
            assert_eq!(parsed.original, path);
            assert_eq!(parsed.device, device);
            assert_eq!(parsed.stamp, stamp);
        }
        assert_eq!(parse_conflict_copy("note.md"), None);
        assert_eq!(parse_conflict_copy("meeting (conflict notes).md"), None);
        assert_eq!(
            parse_conflict_copy("(conflict dev 2026-10-02 1432).md"),
            None
        );
        assert_eq!(parse_conflict_copy("x (conflict dev not-a-date).md"), None);
    }

    #[test]
    fn unique_names_avoid_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let first = unique_conflict_path(dir.path(), "a.md", "dev", "stamp");
        std::fs::write(dir.path().join(&first), "x").unwrap();
        let second = unique_conflict_path(dir.path(), "a.md", "dev", "stamp");
        assert_ne!(first, second);
        assert!(second.ends_with("(conflict dev stamp 2).md"));
    }
}
