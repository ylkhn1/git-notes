//! Conflict copies in the working tree: finding them, comparing them with the file they were
//! split from, and resolving them.
//!
//! A conflict copy is any file named like `note (conflict <device> <YYYY-MM-DD HHmm>).md`,
//! whichever device created it. Every copy is committed before the UI ever sees it, so each
//! resolution below is recoverable from history.

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, AppResult};
use crate::git::history::{self, ChangeKind, FileDiff};
use crate::git::merge::parse_conflict_copy;
use crate::notebook::{files, paths};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    /// The copy, e.g. `work/plan (conflict pixel-8 2026-10-02 1432).md`.
    pub copy: String,
    /// The file it was split from (`work/plan.md`); may have been deleted since.
    pub original: String,
    pub original_exists: bool,
    /// Device that made the copy.
    pub device: String,
    /// Local time on that device, `YYYY-MM-DD HHmm`.
    pub stamp: String,
}

/// Every conflict copy in the notebook, sorted by path. Hidden files and `.git` are skipped
/// the same way the file tree skips them.
pub fn list(root: &Path) -> AppResult<Vec<ConflictInfo>> {
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .build();
    let mut out = Vec::new();
    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                tracing::warn!(%error, "skipping unreadable entry");
                continue;
            }
        };
        if entry.depth() == 0 || !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let rel = paths::to_rel(root, entry.path())?;
        if let Some(name) = parse_conflict_copy(&rel) {
            out.push(ConflictInfo {
                original_exists: root.join(&name.original).is_file(),
                copy: rel,
                original: name.original,
                device: name.device,
                stamp: name.stamp,
            });
        }
    }
    out.sort_by(|a, b| a.copy.cmp(&b.copy));
    Ok(out)
}

/// The copy compared with the current file: `old` is the current file, `new` the copy.
pub fn diff(root: &Path, copy: &str) -> AppResult<FileDiff> {
    let copy = paths::normalize(copy)?;
    let name = parse_conflict_copy(&copy)
        .ok_or_else(|| AppError::invalid_input(format!("{copy} is not a conflict copy")))?;
    let copy_bytes =
        read(root, &copy)?.ok_or_else(|| AppError::not_found(format!("{copy} does not exist")))?;
    let current_bytes = read(root, &name.original)?;
    let kind = if current_bytes.is_some() {
        ChangeKind::Modified
    } else {
        ChangeKind::Added
    };
    history::text_diff(&copy, kind, current_bytes, Some(copy_bytes))
}

fn read(root: &Path, rel: &str) -> AppResult<Option<Vec<u8>>> {
    match std::fs::read(paths::resolve(root, rel)?) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ConflictResolution {
    /// Keep the current file as it is and delete the copy.
    KeepCurrent,
    /// Replace the current file with the copy (and delete the copy).
    UseCopy,
    /// Keep both: the copy is renamed to an ordinary name without the conflict marker.
    KeepBoth,
}

/// What a resolution left behind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedConflict {
    /// Paths that now hold the kept text(s).
    pub kept: Vec<String>,
    /// Paths that no longer exist.
    pub removed: Vec<String>,
}

pub fn resolve(root: &Path, copy: &str, how: ConflictResolution) -> AppResult<ResolvedConflict> {
    let copy = paths::normalize(copy)?;
    let name = parse_conflict_copy(&copy)
        .ok_or_else(|| AppError::invalid_input(format!("{copy} is not a conflict copy")))?;
    let copy_abs = paths::resolve(root, &copy)?;
    if !copy_abs.is_file() {
        return Err(AppError::not_found(format!("{copy} does not exist")));
    }
    match how {
        ConflictResolution::KeepCurrent => {
            files::delete(root, &copy)?;
            Ok(ResolvedConflict {
                kept: vec![name.original],
                removed: vec![copy],
            })
        }
        ConflictResolution::UseCopy => {
            let bytes = std::fs::read(&copy_abs)?;
            let original_abs = paths::resolve(root, &name.original)?;
            if let Some(parent) = original_abs.parent() {
                std::fs::create_dir_all(parent)?;
            }
            files::write_atomic(&original_abs, &bytes)?;
            files::delete(root, &copy)?;
            Ok(ResolvedConflict {
                kept: vec![name.original],
                removed: vec![copy],
            })
        }
        ConflictResolution::KeepBoth => {
            let target = unique_plain_name(root, &name.original, &name.device, &name.stamp);
            let renamed = files::rename(root, &copy, &target)?;
            Ok(ResolvedConflict {
                kept: vec![name.original, renamed],
                removed: vec![copy],
            })
        }
    }
}

/// `dir/note.md` + `pixel-8` + stamp → `dir/note (pixel-8 2026-10-02 1432).md`: tells where
/// the text came from without matching the conflict pattern again.
fn plain_name(original: &str, device: &str, stamp: &str) -> String {
    let (dir, file) = match original.rsplit_once('/') {
        Some((dir, file)) => (Some(dir), file),
        None => (None, original),
    };
    let (stem, ext) = match file.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, Some(ext)),
        _ => (file, None),
    };
    let mut name = format!("{stem} ({device} {stamp})");
    if let Some(ext) = ext {
        name.push('.');
        name.push_str(ext);
    }
    match dir {
        Some(dir) => format!("{dir}/{name}"),
        None => name,
    }
}

fn unique_plain_name(root: &Path, original: &str, device: &str, stamp: &str) -> String {
    let base = plain_name(original, device, stamp);
    if !root.join(&base).exists() {
        return base;
    }
    for n in 2..1000 {
        let candidate = plain_name(original, device, &format!("{stamp} {n}"));
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    base
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::merge::conflict_copy_path;

    const STAMP: &str = "2026-10-02 1432";

    fn notebook() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("work")).unwrap();
        std::fs::write(root.join("work/plan.md"), "theirs\n").unwrap();
        let copy = conflict_copy_path("work/plan.md", "pixel-8", STAMP);
        std::fs::write(root.join(&copy), "ours\n").unwrap();
        std::fs::write(root.join("plain.md"), "no conflict\n").unwrap();
        std::fs::write(root.join(".hidden (conflict x 2026-10-02 1432).md"), "skip").unwrap();
        (dir, copy)
    }

    #[test]
    fn lists_and_diffs_copies() {
        let (dir, copy) = notebook();
        let orphan = conflict_copy_path("gone.md", "laptop", STAMP);
        std::fs::write(dir.path().join(&orphan), "orphan\n").unwrap();

        let found = list(dir.path()).unwrap();
        assert_eq!(found.len(), 2, "{found:?}");
        assert_eq!(found[0].copy, orphan);
        assert!(!found[0].original_exists);
        assert_eq!(found[1].copy, copy);
        assert_eq!(found[1].original, "work/plan.md");
        assert_eq!(found[1].device, "pixel-8");
        assert_eq!(found[1].stamp, STAMP);
        assert!(found[1].original_exists);

        let compared = diff(dir.path(), &copy).unwrap();
        assert_eq!(compared.kind, ChangeKind::Modified);
        assert_eq!(compared.old_text.as_deref(), Some("theirs\n"));
        assert_eq!(compared.new_text.as_deref(), Some("ours\n"));
        assert_eq!(compared.hunks.len(), 1);

        let orphan_diff = diff(dir.path(), &orphan).unwrap();
        assert_eq!(orphan_diff.kind, ChangeKind::Added);
        assert_eq!(orphan_diff.old_text, None);

        assert!(matches!(
            diff(dir.path(), "plain.md"),
            Err(AppError::InvalidInput { .. })
        ));
    }

    #[test]
    fn keep_current_deletes_the_copy() {
        let (dir, copy) = notebook();
        let result = resolve(dir.path(), &copy, ConflictResolution::KeepCurrent).unwrap();
        assert_eq!(result.kept, vec!["work/plan.md"]);
        assert_eq!(result.removed, vec![copy.clone()]);
        assert!(!dir.path().join(&copy).exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("work/plan.md")).unwrap(),
            "theirs\n"
        );
        assert!(list(dir.path()).unwrap().is_empty());
        assert!(matches!(
            resolve(dir.path(), &copy, ConflictResolution::KeepCurrent),
            Err(AppError::NotFound { .. })
        ));
    }

    #[test]
    fn use_copy_replaces_the_current_file() {
        let (dir, copy) = notebook();
        let result = resolve(dir.path(), &copy, ConflictResolution::UseCopy).unwrap();
        assert_eq!(result.kept, vec!["work/plan.md"]);
        assert!(!dir.path().join(&copy).exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("work/plan.md")).unwrap(),
            "ours\n"
        );

        // Works when the original was deleted on the other side, too.
        let orphan = conflict_copy_path("gone/note.md", "laptop", STAMP);
        std::fs::create_dir_all(dir.path().join("gone")).unwrap();
        std::fs::write(dir.path().join(&orphan), "back\n").unwrap();
        resolve(dir.path(), &orphan, ConflictResolution::UseCopy).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("gone/note.md")).unwrap(),
            "back\n"
        );
    }

    #[test]
    fn keep_both_renames_out_of_the_pattern() {
        let (dir, copy) = notebook();
        let result = resolve(dir.path(), &copy, ConflictResolution::KeepBoth).unwrap();
        assert_eq!(result.kept[0], "work/plan.md");
        assert_eq!(result.kept[1], "work/plan (pixel-8 2026-10-02 1432).md");
        assert!(dir.path().join(&result.kept[1]).is_file());
        assert!(!dir.path().join(&copy).exists());
        assert!(list(dir.path()).unwrap().is_empty());

        // A second copy of the same file keeps a distinct name.
        std::fs::write(dir.path().join(&copy), "again\n").unwrap();
        let again = resolve(dir.path(), &copy, ConflictResolution::KeepBoth).unwrap();
        assert_eq!(again.kept[1], "work/plan (pixel-8 2026-10-02 1432 2).md");
    }
}
