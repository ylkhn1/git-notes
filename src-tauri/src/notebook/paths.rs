//! Safe handling of notebook-relative paths.
//!
//! Every path that crosses the IPC boundary is relative to the notebook root and uses `/`
//! as separator. [`resolve`] is the single choke point that turns such a string into an
//! absolute path, rejecting anything that could escape the notebook.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Normalizes a user/IPC-supplied relative path and joins it onto `root`.
///
/// Rejects absolute paths, `..` segments, empty paths and NUL bytes. Backslashes are treated
/// as separators so paths typed on Windows behave the same everywhere.
pub fn resolve(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let normalized = normalize(rel)?;
    Ok(root.join(normalized))
}

/// Returns the normalized relative form (`a/b/c.md`) of `rel`, or an error if it is unsafe.
pub fn normalize(rel: &str) -> AppResult<String> {
    if rel.contains('\0') {
        return Err(AppError::invalid_input("path contains NUL byte"));
    }
    let unified = rel.replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for component in Path::new(&unified).components() {
        match component {
            Component::Normal(part) => {
                let part = part
                    .to_str()
                    .ok_or_else(|| AppError::invalid_input("path is not valid UTF-8"))?;
                parts.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::invalid_input(format!(
                    "path '{rel}' must not contain '..'"
                )));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::invalid_input(format!(
                    "path '{rel}' must be relative to the notebook"
                )));
            }
        }
    }
    if parts.is_empty() {
        return Err(AppError::invalid_input("path must not be empty"));
    }
    Ok(parts.join("/"))
}

/// Converts an absolute path inside `root` back to the IPC form.
pub fn to_rel(root: &Path, abs: &Path) -> AppResult<String> {
    let rel = abs
        .strip_prefix(root)
        .map_err(|_| AppError::internal(format!("{} is outside the notebook", abs.display())))?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    Ok(parts.join("/"))
}

/// Parent of a relative path (`a/b/c.md` → `a/b`), or `""` for top-level entries.
pub fn parent(rel: &str) -> &str {
    rel.rsplit_once('/').map_or("", |(parent, _)| parent)
}

/// File name of a relative path (`a/b/c.md` → `c.md`).
pub fn file_name(rel: &str) -> &str {
    rel.rsplit_once('/').map_or(rel, |(_, name)| name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_separators_and_dots() {
        assert_eq!(normalize("a\\b/./c.md").unwrap(), "a/b/c.md");
        assert_eq!(normalize("./note.md").unwrap(), "note.md");
        assert_eq!(normalize("dir/").unwrap(), "dir");
    }

    #[test]
    fn rejects_escapes() {
        assert!(normalize("../x.md").is_err());
        assert!(normalize("a/../../x.md").is_err());
        assert!(normalize("/etc/passwd").is_err());
        assert!(normalize("").is_err());
        assert!(normalize("a\0b").is_err());
    }

    #[test]
    fn resolves_inside_root() {
        let root = Path::new("/tmp/nb");
        assert_eq!(resolve(root, "a/b.md").unwrap(), root.join("a/b.md"));
        assert!(resolve(root, "../b.md").is_err());
    }

    #[test]
    fn rel_helpers() {
        assert_eq!(parent("a/b/c.md"), "a/b");
        assert_eq!(parent("c.md"), "");
        assert_eq!(file_name("a/b/c.md"), "c.md");
        assert_eq!(file_name("c.md"), "c.md");
        assert_eq!(
            to_rel(Path::new("/r"), Path::new("/r/x/y.md")).unwrap(),
            "x/y.md"
        );
    }
}
