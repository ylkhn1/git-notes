//! Notebooks: a notebook is a plain directory of Markdown files (and, from Phase 2, a git
//! repository). This module owns everything that touches the notebook on disk.
//!
//! Nothing here depends on Tauri; the command layer resolves notebook ids to roots and
//! calls into these functions.

pub mod assets;
pub mod files;
pub mod paths;
pub mod registry;
pub mod tree;
pub mod watcher;

pub use assets::SavedAsset;
pub use files::{FileContent, WriteResult};
pub use registry::{NotebookInfo, Registry};
pub use tree::{EntryKind, TreeNode};
pub use watcher::NotebookWatcher;

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Creates a new notebook directory `parent/name` with a starter note.
pub fn create(parent: &Path, name: &str) -> AppResult<PathBuf> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::invalid_input("notebook name must not be empty"));
    }
    if name.contains(['/', '\\', '\0']) || name == "." || name == ".." {
        return Err(AppError::invalid_input(format!(
            "'{name}' is not a valid notebook name"
        )));
    }
    let dir = parent.join(name);
    if dir.exists() {
        return Err(AppError::already_exists(format!(
            "{} already exists",
            dir.display()
        )));
    }
    std::fs::create_dir_all(&dir)?;
    files::write_text(
        &dir,
        "Welcome.md",
        "# Welcome\n\nThis notebook is a folder of Markdown files. Start writing!\n",
    )?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_makes_dir_with_starter_note() {
        let parent = tempfile::tempdir().unwrap();
        let dir = create(parent.path(), " Work ").unwrap();
        assert_eq!(dir, parent.path().join("Work"));
        assert!(dir.join("Welcome.md").is_file());
        assert!(matches!(
            create(parent.path(), "Work"),
            Err(AppError::AlreadyExists { .. })
        ));
        assert!(create(parent.path(), "").is_err());
        assert!(create(parent.path(), "a/b").is_err());
    }
}
