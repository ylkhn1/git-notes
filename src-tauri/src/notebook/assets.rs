//! Images and other binary attachments live in `assets/` at the notebook root.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::paths;
use crate::error::{AppError, AppResult};

pub const ASSETS_DIR: &str = "assets";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedAsset {
    /// Notebook-relative path of the stored file, e.g. `assets/screenshot-20261002-1530.png`.
    pub path: String,
    /// Markdown snippet to insert into the note (link is relative to the note's directory).
    pub markdown: String,
}

/// Stores `bytes` under `assets/` with a unique, filesystem-safe name and returns the
/// Markdown to embed it from `note_rel`.
pub fn save_bytes(
    root: &Path,
    note_rel: &str,
    file_name: &str,
    bytes: &[u8],
) -> AppResult<SavedAsset> {
    if bytes.is_empty() {
        return Err(AppError::invalid_input("asset is empty"));
    }
    let note_rel = paths::normalize(note_rel)?;
    let assets_dir = root.join(ASSETS_DIR);
    fs::create_dir_all(&assets_dir)?;

    let (stem, ext) = split_name(file_name);
    let mut candidate = format!("{stem}.{ext}");
    let mut counter = 1;
    while assets_dir.join(&candidate).exists() {
        counter += 1;
        candidate = format!("{stem}-{counter}.{ext}");
    }
    let abs = assets_dir.join(&candidate);
    super::files::write_atomic(&abs, bytes)?;

    let rel = format!("{ASSETS_DIR}/{candidate}");
    let markdown = markdown_for(&note_rel, &rel, &stem);
    Ok(SavedAsset {
        path: rel,
        markdown,
    })
}

/// Copies an existing file (e.g. dropped from the desktop) into `assets/`.
pub fn import_file(root: &Path, note_rel: &str, source: &Path) -> AppResult<SavedAsset> {
    let bytes = fs::read(source).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => {
            AppError::not_found(format!("{} does not exist", source.display()))
        }
        _ => AppError::from(e),
    })?;
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_owned());
    save_bytes(root, note_rel, &name, &bytes)
}

/// Splits `name` into a sanitized stem and a lowercase extension (`png` when missing).
fn split_name(name: &str) -> (String, String) {
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() => (s, e.to_ascii_lowercase()),
        _ => (name, "png".to_owned()),
    };
    let mut clean: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    while clean.contains("--") {
        clean = clean.replace("--", "-");
    }
    let clean = clean.trim_matches('-');
    let stem = if clean.is_empty() { "image" } else { clean };
    (stem.to_owned(), ext)
}

fn markdown_for(note_rel: &str, asset_rel: &str, alt: &str) -> String {
    let depth = paths::parent(note_rel)
        .split('/')
        .filter(|s| !s.is_empty())
        .count();
    let prefix = "../".repeat(depth);
    format!("![{alt}]({prefix}{asset_rel})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_with_unique_names_and_relative_links() {
        let dir = tempfile::tempdir().unwrap();
        let a = save_bytes(dir.path(), "note.md", "Shot 1.PNG", b"abc").unwrap();
        assert_eq!(a.path, "assets/Shot-1.png");
        assert_eq!(a.markdown, "![Shot-1](assets/Shot-1.png)");

        let b = save_bytes(dir.path(), "sub/dir/note.md", "Shot 1.png", b"def").unwrap();
        assert_eq!(b.path, "assets/Shot-1-2.png");
        assert_eq!(b.markdown, "![Shot-1](../../assets/Shot-1-2.png)");
        assert_eq!(
            fs::read(dir.path().join("assets/Shot-1-2.png")).unwrap(),
            b"def"
        );
    }

    #[test]
    fn sanitizes_odd_names() {
        assert_eq!(
            split_name("../../etc/passwd"),
            ("passwd".to_owned(), "png".to_owned())
        );
        assert_eq!(
            split_name("image.png"),
            ("image".to_owned(), "png".to_owned())
        );
        assert_eq!(
            split_name("Снимок экрана.jpeg"),
            ("Снимок-экрана".to_owned(), "jpeg".to_owned())
        );
        assert_eq!(split_name("***"), ("image".to_owned(), "png".to_owned()));
    }

    #[test]
    fn imports_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("photo.jpg");
        fs::write(&src, b"jpg").unwrap();
        let saved = import_file(dir.path(), "n.md", &src).unwrap();
        assert_eq!(saved.path, "assets/photo.jpg");
        assert!(import_file(dir.path(), "n.md", &dir.path().join("missing.jpg")).is_err());
        assert!(save_bytes(dir.path(), "n.md", "x.png", b"").is_err());
    }
}
