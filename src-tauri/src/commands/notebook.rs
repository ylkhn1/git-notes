use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::error::{AppError, AppResult};
use crate::notebook::{
    self, FileContent, NotebookInfo, NotebookWatcher, SavedAsset, TreeNode, WriteResult,
};
use crate::state::{AppState, lock};

/// Emitted (debounced) when files inside a watched notebook change on disk.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct NotebookChanged {
    pub notebook_id: String,
    /// Notebook-relative paths; empty string when the change could not be attributed.
    pub paths: Vec<String>,
}

fn root(state: &AppState, notebook_id: &str) -> AppResult<PathBuf> {
    lock(&state.registry)?.root(notebook_id)
}

#[tauri::command]
#[specta::specta]
pub fn list_notebooks(state: State<'_, AppState>) -> AppResult<Vec<NotebookInfo>> {
    Ok(lock(&state.registry)?.list().to_vec())
}

#[tauri::command]
#[specta::specta]
pub fn default_notebooks_dir(state: State<'_, AppState>) -> AppResult<String> {
    Ok(state.default_notebooks_dir.to_string_lossy().into_owned())
}

/// Creates `parent_dir/name` (defaults to the platform notebooks dir) and registers it.
#[tauri::command]
#[specta::specta]
pub fn create_notebook(
    state: State<'_, AppState>,
    name: String,
    parent_dir: Option<String>,
) -> AppResult<NotebookInfo> {
    let parent = parent_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| state.default_notebooks_dir.clone());
    std::fs::create_dir_all(&parent)?;
    let dir = notebook::create(&parent, &name)?;
    lock(&state.registry)?.add(&dir)
}

/// Registers an existing folder (picked with the system dialog) as a notebook.
#[tauri::command]
#[specta::specta]
pub fn open_notebook(state: State<'_, AppState>, path: String) -> AppResult<NotebookInfo> {
    lock(&state.registry)?.add(Path::new(&path))
}

/// Removes the notebook from the list; files on disk are untouched.
#[tauri::command]
#[specta::specta]
pub fn forget_notebook(state: State<'_, AppState>, notebook_id: String) -> AppResult<()> {
    lock(&state.watchers)?.remove(&notebook_id);
    lock(&state.registry)?.remove(&notebook_id)
}

#[tauri::command]
#[specta::specta]
pub fn list_tree(state: State<'_, AppState>, notebook_id: String) -> AppResult<Vec<TreeNode>> {
    notebook::tree::list_tree(&root(&state, &notebook_id)?)
}

#[tauri::command]
#[specta::specta]
pub fn read_file(
    state: State<'_, AppState>,
    notebook_id: String,
    path: String,
) -> AppResult<FileContent> {
    notebook::files::read_text(&root(&state, &notebook_id)?, &path)
}

/// Writes the file atomically and returns its new modification time (ms since epoch).
#[tauri::command]
#[specta::specta]
pub fn write_file(
    state: State<'_, AppState>,
    notebook_id: String,
    path: String,
    text: String,
) -> AppResult<WriteResult> {
    notebook::files::write_text(&root(&state, &notebook_id)?, &path, &text)
}

#[tauri::command]
#[specta::specta]
pub fn create_file(
    state: State<'_, AppState>,
    notebook_id: String,
    path: String,
) -> AppResult<String> {
    notebook::files::create_file(&root(&state, &notebook_id)?, &path)
}

#[tauri::command]
#[specta::specta]
pub fn create_dir(
    state: State<'_, AppState>,
    notebook_id: String,
    path: String,
) -> AppResult<String> {
    notebook::files::create_dir(&root(&state, &notebook_id)?, &path)
}

/// Renames or moves a file/folder. Returns the normalized new path.
#[tauri::command]
#[specta::specta]
pub fn rename_entry(
    state: State<'_, AppState>,
    notebook_id: String,
    from: String,
    to: String,
) -> AppResult<String> {
    notebook::files::rename(&root(&state, &notebook_id)?, &from, &to)
}

#[tauri::command]
#[specta::specta]
pub fn delete_entry(
    state: State<'_, AppState>,
    notebook_id: String,
    path: String,
) -> AppResult<()> {
    notebook::files::delete(&root(&state, &notebook_id)?, &path)
}

/// Stores pasted image bytes under `assets/` and returns the Markdown to insert.
#[tauri::command]
#[specta::specta]
pub fn save_asset(
    state: State<'_, AppState>,
    notebook_id: String,
    note_path: String,
    file_name: String,
    bytes: Vec<u8>,
) -> AppResult<SavedAsset> {
    notebook::assets::save_bytes(&root(&state, &notebook_id)?, &note_path, &file_name, &bytes)
}

/// Copies a file dropped from the desktop into `assets/`.
#[tauri::command]
#[specta::specta]
pub fn import_asset(
    state: State<'_, AppState>,
    notebook_id: String,
    note_path: String,
    source_path: String,
) -> AppResult<SavedAsset> {
    notebook::assets::import_file(
        &root(&state, &notebook_id)?,
        &note_path,
        Path::new(&source_path),
    )
}

/// Starts emitting [`NotebookChanged`] events for the notebook (idempotent).
#[tauri::command]
#[specta::specta]
pub fn watch_notebook(
    app: AppHandle,
    state: State<'_, AppState>,
    notebook_id: String,
) -> AppResult<()> {
    let root = root(&state, &notebook_id)?;
    let mut watchers = lock(&state.watchers)?;
    if watchers.contains_key(&notebook_id) {
        return Ok(());
    }
    let id = notebook_id.clone();
    let watcher = NotebookWatcher::start(&root, move |paths| {
        let event = NotebookChanged {
            notebook_id: id.clone(),
            paths,
        };
        if let Err(error) = event.emit(&app) {
            tracing::warn!(%error, "failed to emit NotebookChanged");
        }
    })?;
    watchers.insert(notebook_id, watcher);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn unwatch_notebook(state: State<'_, AppState>, notebook_id: String) -> AppResult<()> {
    lock(&state.watchers)?
        .remove(&notebook_id)
        .map(|_| ())
        .ok_or_else(|| AppError::not_found(format!("notebook {notebook_id} is not watched")))
}
