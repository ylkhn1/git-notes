//! Reading, writing, creating, renaming and deleting entries inside a notebook.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::paths;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub text: String,
    /// Last modification time in milliseconds since the Unix epoch.
    #[specta(type = specta_typescript::Number)]
    pub modified_ms: u64,
}

/// Result of a write: the file's new modification time, used to detect external edits.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    #[specta(type = specta_typescript::Number)]
    pub modified_ms: u64,
}

pub fn read_text(root: &Path, rel: &str) -> AppResult<FileContent> {
    let abs = paths::resolve(root, rel)?;
    let text = match fs::read_to_string(&abs) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::not_found(format!("{rel} does not exist")));
        }
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            return Err(AppError::invalid_input(format!(
                "{rel} is not a UTF-8 text file"
            )));
        }
        Err(e) => return Err(e.into()),
    };
    Ok(FileContent {
        path: paths::normalize(rel)?,
        text,
        modified_ms: modified_ms(&abs)?,
    })
}

/// Writes `text` atomically (temp file + rename) and returns the new modification time.
pub fn write_text(root: &Path, rel: &str, text: &str) -> AppResult<WriteResult> {
    let abs = paths::resolve(root, rel)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(&abs, text.as_bytes())?;
    Ok(WriteResult {
        modified_ms: modified_ms(&abs)?,
    })
}

/// Creates an empty file. Fails if something already exists at that path.
pub fn create_file(root: &Path, rel: &str) -> AppResult<String> {
    let abs = paths::resolve(root, rel)?;
    if abs.exists() {
        return Err(AppError::already_exists(format!("{rel} already exists")));
    }
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&abs, b"")?;
    paths::normalize(rel)
}

pub fn create_dir(root: &Path, rel: &str) -> AppResult<String> {
    let abs = paths::resolve(root, rel)?;
    if abs.exists() {
        return Err(AppError::already_exists(format!("{rel} already exists")));
    }
    fs::create_dir_all(&abs)?;
    paths::normalize(rel)
}

/// Renames or moves a file or directory. Parent directories of `to` are created as needed.
pub fn rename(root: &Path, from: &str, to: &str) -> AppResult<String> {
    let src = paths::resolve(root, from)?;
    let dst = paths::resolve(root, to)?;
    if !src.exists() {
        return Err(AppError::not_found(format!("{from} does not exist")));
    }
    if src == dst {
        return paths::normalize(to);
    }
    if dst.exists() {
        return Err(AppError::already_exists(format!("{to} already exists")));
    }
    if dst.starts_with(&src) {
        return Err(AppError::invalid_input(format!(
            "cannot move {from} into itself"
        )));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&src, &dst)?;
    paths::normalize(to)
}

/// Deletes a file or a directory (recursively).
pub fn delete(root: &Path, rel: &str) -> AppResult<()> {
    let abs = paths::resolve(root, rel)?;
    let meta = match fs::symlink_metadata(&abs) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::not_found(format!("{rel} does not exist")));
        }
        Err(e) => return Err(e.into()),
    };
    if meta.is_dir() {
        fs::remove_dir_all(&abs)?;
    } else {
        fs::remove_file(&abs)?;
    }
    Ok(())
}

/// Copies an outside file (dropped from the file manager) into the folder `dir` of the
/// notebook, keeping its name; `name 2.ext`, `name 3.ext`, … when taken. Returns the new
/// relative path. Folders are not imported.
pub fn import_into(root: &Path, dir: &str, source: &Path) -> AppResult<String> {
    let meta = fs::metadata(source).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => {
            AppError::not_found(format!("{} does not exist", source.display()))
        }
        _ => AppError::from(e),
    })?;
    if !meta.is_file() {
        return Err(AppError::invalid_input(format!(
            "{} is a folder; only files can be added",
            source.display()
        )));
    }
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::invalid_input("the file has no name"))?;
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_owned(), format!(".{ext}")),
        _ => (name.clone(), String::new()),
    };
    let dir = if dir.is_empty() {
        String::new()
    } else {
        paths::normalize(dir)?
    };
    let join = |file: &str| {
        if dir.is_empty() {
            file.to_owned()
        } else {
            format!("{dir}/{file}")
        }
    };
    let mut rel = join(&name);
    let mut counter = 1;
    while paths::resolve(root, &rel)?.exists() {
        counter += 1;
        rel = join(&format!("{stem} {counter}{ext}"));
    }
    let abs = paths::resolve(root, &rel)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(&abs, &fs::read(source)?)?;
    Ok(rel)
}

/// Writes to a sibling temp file and renames it over `path` so readers never see a torn file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::internal("path has no parent directory"))?;
    let name = path
        .file_name()
        .ok_or_else(|| AppError::internal("path has no file name"))?
        .to_string_lossy();
    let tmp = parent.join(format!(".{name}.{}.tmp", std::process::id()));
    fs::write(&tmp, bytes)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

pub fn modified_ms(path: &Path) -> AppResult<u64> {
    let modified = fs::metadata(path)?.modified()?;
    let ms = modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(u64::try_from(ms).unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn write_then_read_roundtrip() {
        let dir = root();
        let written = write_text(dir.path(), "notes/today.md", "# Hi\n").unwrap();
        let content = read_text(dir.path(), "notes/today.md").unwrap();
        assert_eq!(content.text, "# Hi\n");
        assert_eq!(content.path, "notes/today.md");
        assert_eq!(content.modified_ms, written.modified_ms);
        assert!(!dir.path().join("notes/.today.md.tmp").exists());
        assert!(
            fs::read_dir(dir.path().join("notes")).unwrap().count() == 1,
            "no temp files left"
        );
    }

    #[test]
    fn read_missing_is_not_found() {
        let dir = root();
        assert!(matches!(
            read_text(dir.path(), "nope.md"),
            Err(AppError::NotFound { .. })
        ));
    }

    #[test]
    fn create_rejects_duplicates() {
        let dir = root();
        create_file(dir.path(), "a.md").unwrap();
        assert!(matches!(
            create_file(dir.path(), "a.md"),
            Err(AppError::AlreadyExists { .. })
        ));
        create_dir(dir.path(), "sub/deep").unwrap();
        assert!(dir.path().join("sub/deep").is_dir());
    }

    #[test]
    fn rename_moves_across_directories() {
        let dir = root();
        write_text(dir.path(), "a.md", "x").unwrap();
        let to = rename(dir.path(), "a.md", "archive/2026/a.md").unwrap();
        assert_eq!(to, "archive/2026/a.md");
        assert!(!dir.path().join("a.md").exists());
        assert_eq!(
            read_text(dir.path(), "archive/2026/a.md").unwrap().text,
            "x"
        );

        write_text(dir.path(), "b.md", "y").unwrap();
        assert!(matches!(
            rename(dir.path(), "b.md", "archive/2026/a.md"),
            Err(AppError::AlreadyExists { .. })
        ));
        assert!(matches!(
            rename(dir.path(), "archive", "archive/inner"),
            Err(AppError::InvalidInput { .. })
        ));
    }

    #[test]
    fn delete_file_and_directory() {
        let dir = root();
        write_text(dir.path(), "d/one.md", "1").unwrap();
        write_text(dir.path(), "d/two.md", "2").unwrap();
        delete(dir.path(), "d/one.md").unwrap();
        assert!(!dir.path().join("d/one.md").exists());
        delete(dir.path(), "d").unwrap();
        assert!(!dir.path().join("d").exists());
        assert!(matches!(
            delete(dir.path(), "d"),
            Err(AppError::NotFound { .. })
        ));
    }

    #[test]
    fn never_escapes_root() {
        let dir = root();
        assert!(write_text(dir.path(), "../escape.md", "x").is_err());
        assert!(delete(dir.path(), "/etc/hosts").is_err());
    }

    #[test]
    fn import_into_copies_with_unique_names() {
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("Report.pdf");
        fs::write(&src, b"pdf").unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            import_into(dir.path(), "docs", &src).unwrap(),
            "docs/Report.pdf"
        );
        assert_eq!(
            import_into(dir.path(), "docs", &src).unwrap(),
            "docs/Report 2.pdf"
        );
        assert_eq!(import_into(dir.path(), "", &src).unwrap(), "Report.pdf");
        assert_eq!(
            fs::read(dir.path().join("docs/Report 2.pdf")).unwrap(),
            b"pdf"
        );
        assert!(import_into(dir.path(), "", outside.path()).is_err());
        assert!(import_into(dir.path(), "../x", &src).is_err());
    }
}
