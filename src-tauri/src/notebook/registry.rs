//! The list of notebooks the app knows about, persisted as JSON in the app config dir.
//!
//! Only metadata lives here (name + path). Notebook content is the folder itself.

use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotebookInfo {
    /// Stable identifier derived from the canonical path.
    pub id: String,
    pub name: String,
    /// Absolute path on disk. Shown to the user, never used by the frontend for I/O.
    pub path: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RegistryFile {
    notebooks: Vec<NotebookInfo>,
}

/// In-memory registry with its backing file.
#[derive(Debug)]
pub struct Registry {
    file: PathBuf,
    notebooks: Vec<NotebookInfo>,
}

impl Registry {
    /// Loads the registry from `file`, starting empty if it does not exist yet.
    pub fn load(file: PathBuf) -> AppResult<Self> {
        let notebooks = match fs::read_to_string(&file) {
            Ok(text) => {
                serde_json::from_str::<RegistryFile>(&text)
                    .map_err(|e| AppError::internal(format!("corrupt notebooks.json: {e}")))?
                    .notebooks
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self { file, notebooks })
    }

    pub fn list(&self) -> &[NotebookInfo] {
        &self.notebooks
    }

    pub fn get(&self, id: &str) -> AppResult<&NotebookInfo> {
        self.notebooks
            .iter()
            .find(|n| n.id == id)
            .ok_or_else(|| AppError::not_found(format!("notebook {id} is not registered")))
    }

    /// Root directory of a registered notebook.
    pub fn root(&self, id: &str) -> AppResult<PathBuf> {
        Ok(PathBuf::from(&self.get(id)?.path))
    }

    /// Registers an existing directory. Re-opening a known notebook returns the existing entry.
    pub fn add(&mut self, dir: &Path) -> AppResult<NotebookInfo> {
        if !dir.is_dir() {
            return Err(AppError::invalid_input(format!(
                "{} is not a directory",
                dir.display()
            )));
        }
        let canonical = dir.canonicalize()?;
        let id = notebook_id(&canonical);
        if let Some(existing) = self.notebooks.iter().find(|n| n.id == id) {
            return Ok(existing.clone());
        }
        let name = canonical
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Notebook".to_owned());
        let info = NotebookInfo {
            id,
            name,
            path: canonical.to_string_lossy().into_owned(),
        };
        self.notebooks.push(info.clone());
        self.save()?;
        Ok(info)
    }

    /// Forgets a notebook without touching its files.
    pub fn remove(&mut self, id: &str) -> AppResult<()> {
        let before = self.notebooks.len();
        self.notebooks.retain(|n| n.id != id);
        if self.notebooks.len() == before {
            return Err(AppError::not_found(format!(
                "notebook {id} is not registered"
            )));
        }
        self.save()
    }

    fn save(&self) -> AppResult<()> {
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(&RegistryFile {
            notebooks: self.notebooks.clone(),
        })
        .map_err(|e| AppError::internal(e.to_string()))?;
        super::files::write_atomic(&self.file, text.as_bytes())
    }
}

/// Deterministic id for a notebook path (16 hex chars). No external crates needed.
fn notebook_id(canonical: &Path) -> String {
    let mut hasher = std::hash::DefaultHasher::new();
    canonical.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_list_remove_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let nb = dir.path().join("My Notes");
        fs::create_dir(&nb).unwrap();
        let file = dir.path().join("cfg/notebooks.json");

        let mut reg = Registry::load(file.clone()).unwrap();
        let info = reg.add(&nb).unwrap();
        assert_eq!(info.name, "My Notes");
        assert_eq!(reg.add(&nb).unwrap().id, info.id, "re-adding is idempotent");
        assert_eq!(reg.list().len(), 1);

        let reloaded = Registry::load(file.clone()).unwrap();
        assert_eq!(reloaded.list(), reg.list());

        reg.remove(&info.id).unwrap();
        assert!(reg.list().is_empty());
        assert!(reg.remove(&info.id).is_err());
        assert!(Registry::load(file).unwrap().list().is_empty());
    }

    #[test]
    fn rejects_non_directories() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("file.txt");
        fs::write(&f, "x").unwrap();
        let mut reg = Registry::load(dir.path().join("notebooks.json")).unwrap();
        assert!(reg.add(&f).is_err());
        assert!(reg.add(&dir.path().join("missing")).is_err());
    }
}
