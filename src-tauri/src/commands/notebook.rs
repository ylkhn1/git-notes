use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use crate::error::{AppError, AppResult};
use crate::notebook::{
    self, FileContent, LinkRewrite, NoteLinks, NotebookInfo, NotebookWatcher, SavedAsset,
    SearchResults, TreeNode, WriteResult,
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

pub(super) fn root(state: &AppState, notebook_id: &str) -> AppResult<PathBuf> {
    state.root(notebook_id)
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

/// Creates `parent_dir/name` (defaults to the platform notebooks dir) as a git repository
/// and registers it.
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
    crate::git::init(&dir)?;
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
    state.sync.cancel(&notebook_id);
    state.sync.engine().forget(&notebook_id);
    lock(&state.registry)?.remove(&notebook_id)
}

#[tauri::command]
#[specta::specta]
pub fn list_tree(state: State<'_, AppState>, notebook_id: String) -> AppResult<Vec<TreeNode>> {
    notebook::tree::list_tree(&root(&state, &notebook_id)?)
}

/// Case-insensitive full-text search over the notes; every term must occur on the line.
#[tauri::command]
#[specta::specta]
pub fn search_notes(
    state: State<'_, AppState>,
    notebook_id: String,
    query: String,
    limit: Option<u32>,
) -> AppResult<SearchResults> {
    let limit = usize::try_from(limit.unwrap_or(200).clamp(1, 2000)).unwrap_or(200);
    notebook::search::search(&root(&state, &notebook_id)?, &query, limit)
}

/// Every `[[wiki link]]` in the notebook, grouped by note. Resolution happens in the
/// frontend, which knows the file tree.
#[tauri::command]
#[specta::specta]
pub fn list_note_links(
    state: State<'_, AppState>,
    notebook_id: String,
) -> AppResult<Vec<NoteLinks>> {
    notebook::links::scan(&root(&state, &notebook_id)?)
}

/// Rewrites link targets after a rename or move; returns how many notes changed.
#[tauri::command]
#[specta::specta]
pub fn rewrite_note_links(
    state: State<'_, AppState>,
    notebook_id: String,
    rewrites: Vec<LinkRewrite>,
) -> AppResult<u32> {
    notebook::links::rewrite(&root(&state, &notebook_id)?, &rewrites)
}

/// Saves text shared from another app as a new note at the notebook root and returns its
/// path. `title` is the share sheet's subject, if any.
#[tauri::command]
#[specta::specta]
pub fn save_shared_note(
    state: State<'_, AppState>,
    notebook_id: String,
    title: Option<String>,
    text: String,
) -> AppResult<String> {
    let fallback = format!("Shared {}", crate::git::time::LocalTime::now().stamp());
    notebook::shared::save_shared(
        &root(&state, &notebook_id)?,
        title.as_deref(),
        &text,
        &fallback,
    )
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

/// Starts emitting [`NotebookChanged`] events for the notebook (idempotent). The same
/// signal feeds the auto-sync debounce.
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
        if let Some(state) = app.try_state::<AppState>() {
            state.sync.note_change(&id);
        }
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

/// Stops watching and drops any automatic sync planned for the notebook.
#[tauri::command]
#[specta::specta]
pub fn unwatch_notebook(state: State<'_, AppState>, notebook_id: String) -> AppResult<()> {
    state.sync.cancel(&notebook_id);
    lock(&state.watchers)?
        .remove(&notebook_id)
        .map(|_| ())
        .ok_or_else(|| AppError::not_found(format!("notebook {notebook_id} is not watched")))
}
