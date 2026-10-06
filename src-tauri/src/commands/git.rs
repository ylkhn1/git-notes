use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::error::{AppError, AppResult};
use crate::git::{
    self, ChangedFile, CloneProgress, CloneStage, CommitInfo, DeletedFile, FileDiff, FileVersion,
    NoteCommit, RemoteUrl, RepoStatus,
};
use crate::notebook::{self, NotebookInfo};
use crate::secrets::ConfiguredCredentials;
use crate::state::{AppState, lock};
use crate::sync::{
    ConflictInfo, ConflictResolution, ResolvedConflict, SyncPlan, SyncReport, SyncState,
    SyncTrigger, conflicts,
};

use super::notebook::root;

/// Emitted whenever a notebook's sync state changes.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SyncStateChanged {
    pub notebook_id: String,
    pub state: SyncState,
}

/// Emitted when the scheduler's plan for a notebook changes (next automatic attempt).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlanChanged {
    pub notebook_id: String,
    pub plan: SyncPlan,
}

/// Emitted (throttled) while a clone runs.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgressEvent {
    pub url: String,
    pub progress: CloneProgress,
}

#[tauri::command]
#[specta::specta]
pub fn get_repo_status(state: State<'_, AppState>, notebook_id: String) -> AppResult<RepoStatus> {
    git::status::status(&root(&state, &notebook_id)?)
}

/// Turns a plain notebook folder into a git repository (branch `main`).
#[tauri::command]
#[specta::specta]
pub fn init_repo(state: State<'_, AppState>, notebook_id: String) -> AppResult<RepoStatus> {
    let root = root(&state, &notebook_id)?;
    git::init(&root)?;
    git::status::status(&root)
}

/// Sets (or, with `None`/empty, removes) the `origin` remote.
#[tauri::command]
#[specta::specta]
pub fn set_remote_url(
    state: State<'_, AppState>,
    notebook_id: String,
    url: Option<String>,
) -> AppResult<RepoStatus> {
    let repo = git::open(&root(&state, &notebook_id)?)?;
    match url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(url) => git::remote::set_remote_url(&repo, url)?,
        None => git::remote::remove_remote(&repo)?,
    }
    git::status::status_of(&repo)
}

/// Clones `url` into the notebooks folder (named after the repo unless `name` is given)
/// and registers it. Progress arrives as [`CloneProgressEvent`]s.
#[tauri::command]
#[specta::specta]
pub async fn clone_notebook(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> AppResult<NotebookInfo> {
    let url = url.trim().to_owned();
    let name = name
        .map(|n| n.trim().to_owned())
        .filter(|n| !n.is_empty())
        .or_else(|| RemoteUrl::repo_name(&url))
        .ok_or_else(|| AppError::invalid_input("enter a folder name for the notebook"))?;
    if name.contains(['/', '\\', '\0']) || name == "." || name == ".." {
        return Err(AppError::invalid_input(format!(
            "'{name}' is not a valid folder name"
        )));
    }
    std::fs::create_dir_all(&state.default_notebooks_dir)?;
    let dest = state.default_notebooks_dir.join(&name);
    if dest.exists() {
        return Err(AppError::already_exists(format!(
            "{} already exists",
            dest.display()
        )));
    }

    let credentials = {
        let config = lock(&state.credentials)?;
        ConfiguredCredentials::new(&config, state.secrets.store())
    };
    let hosts = Arc::clone(&state.host_keys);
    let task_url = url.clone();
    let cloned: PathBuf = tokio::task::spawn_blocking(move || {
        use crate::git::CredentialProvider;
        let creds = credentials.credentials_for(&task_url)?;
        let mut last_emit: Option<Instant> = None;
        git::remote::clone(&task_url, &dest, &creds, &hosts, &mut |progress| {
            let finished = progress.stage == CloneStage::Checkout
                && progress.checkout_done == progress.checkout_total;
            if finished || last_emit.is_none_or(|t| t.elapsed() >= Duration::from_millis(120)) {
                last_emit = Some(Instant::now());
                let event = CloneProgressEvent {
                    url: task_url.clone(),
                    progress: progress.clone(),
                };
                if let Err(error) = event.emit(&app) {
                    tracing::debug!(%error, "clone progress event dropped");
                }
            }
        })?;
        Ok::<_, AppError>(dest)
    })
    .await
    .map_err(|e| AppError::internal(format!("clone task failed: {e}")))??;

    lock(&state.registry)?.add(&cloned)
}

/// Runs one full sync now and waits for the report (single-flight per notebook).
#[tauri::command]
#[specta::specta]
pub async fn sync_now(state: State<'_, AppState>, notebook_id: String) -> AppResult<SyncReport> {
    state.sync.sync_now(&notebook_id).await
}

/// Asks for a background sync (focus, resume, notebook opened). Returns at once; progress
/// arrives as [`SyncStateChanged`] events. Ignored while automatic sync is off.
#[tauri::command]
#[specta::specta]
pub fn request_sync(
    state: State<'_, AppState>,
    notebook_id: String,
    trigger: SyncTrigger,
) -> AppResult<()> {
    // Make sure the notebook exists before planning anything for it.
    root(&state, &notebook_id)?;
    state.sync.request(&notebook_id, trigger);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_sync_state(state: State<'_, AppState>, notebook_id: String) -> AppResult<SyncState> {
    Ok(state.sync.engine().state(&notebook_id))
}

#[tauri::command]
#[specta::specta]
pub fn get_sync_plan(state: State<'_, AppState>, notebook_id: String) -> AppResult<SyncPlan> {
    Ok(state.sync.plan(&notebook_id))
}

/// Conflict copies currently in the notebook, whichever device made them.
#[tauri::command]
#[specta::specta]
pub fn list_conflicts(
    state: State<'_, AppState>,
    notebook_id: String,
) -> AppResult<Vec<ConflictInfo>> {
    conflicts::list(&root(&state, &notebook_id)?)
}

/// The copy compared with the current file (`oldText` = current, `newText` = copy).
#[tauri::command]
#[specta::specta]
pub fn get_conflict_diff(
    state: State<'_, AppState>,
    notebook_id: String,
    copy: String,
) -> AppResult<FileDiff> {
    conflicts::diff(&root(&state, &notebook_id)?, &copy)
}

/// Resolves one conflict copy. The resulting change is picked up by auto-sync like any edit.
#[tauri::command]
#[specta::specta]
pub fn resolve_conflict(
    state: State<'_, AppState>,
    notebook_id: String,
    copy: String,
    resolution: ConflictResolution,
) -> AppResult<ResolvedConflict> {
    conflicts::resolve(&root(&state, &notebook_id)?, &copy, resolution)
}

/// Newest-first commits, optionally only those that changed `path`.
#[tauri::command]
#[specta::specta]
pub fn list_history(
    state: State<'_, AppState>,
    notebook_id: String,
    path: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<CommitInfo>> {
    let repo = git::open(&root(&state, &notebook_id)?)?;
    let path = path
        .filter(|p| !p.is_empty())
        .map(|p| notebook::paths::normalize(&p))
        .transpose()?;
    let limit = usize::try_from(limit.unwrap_or(200).clamp(1, 2000)).unwrap_or(200);
    git::history::log(&repo, path.as_deref(), limit)
}

fn parse_oid(commit_id: &str) -> AppResult<git2::Oid> {
    git2::Oid::from_str(commit_id)
        .map_err(|_| AppError::invalid_input(format!("'{commit_id}' is not a commit id")))
}

#[tauri::command]
#[specta::specta]
pub fn list_commit_files(
    state: State<'_, AppState>,
    notebook_id: String,
    commit_id: String,
) -> AppResult<Vec<ChangedFile>> {
    let repo = git::open(&root(&state, &notebook_id)?)?;
    git::history::commit_files(&repo, parse_oid(&commit_id)?)
}

/// How `path` changed in a commit; pass `old_path` for a rename so the old content is used.
#[tauri::command]
#[specta::specta]
pub fn get_file_diff(
    state: State<'_, AppState>,
    notebook_id: String,
    commit_id: String,
    path: String,
    old_path: Option<String>,
) -> AppResult<FileDiff> {
    let repo = git::open(&root(&state, &notebook_id)?)?;
    let path = notebook::paths::normalize(&path)?;
    let oid = parse_oid(&commit_id)?;
    match old_path.filter(|p| !p.is_empty()) {
        Some(old) => {
            let old = notebook::paths::normalize(&old)?;
            git::history::renamed_file_diff(&repo, oid, &old, &path)
        }
        None => git::history::file_diff(&repo, oid, &path),
    }
}

/// Commits that changed one note, newest first, following renames.
#[tauri::command]
#[specta::specta]
pub fn list_note_history(
    state: State<'_, AppState>,
    notebook_id: String,
    path: String,
    limit: Option<u32>,
) -> AppResult<Vec<NoteCommit>> {
    let repo = git::open(&root(&state, &notebook_id)?)?;
    let path = notebook::paths::normalize(&path)?;
    let limit = usize::try_from(limit.unwrap_or(200).clamp(1, 2000)).unwrap_or(200);
    git::history::note_log(&repo, &path, limit)
}

/// A file as stored in a commit (`HEAD` when `commit_id` is absent); `before` reads the
/// commit's first parent, where a file deleted by that commit still exists.
#[tauri::command]
#[specta::specta]
pub fn get_file_version(
    state: State<'_, AppState>,
    notebook_id: String,
    path: String,
    commit_id: Option<String>,
    before: bool,
) -> AppResult<FileVersion> {
    let root = root(&state, &notebook_id)?;
    let path = notebook::paths::normalize(&path)?;
    if !git::is_repo(&root) {
        return Ok(FileVersion {
            missing: true,
            binary: false,
            text: None,
        });
    }
    let repo = git::open(&root)?;
    let oid = commit_id.as_deref().map(parse_oid).transpose()?;
    git::history::file_version(&repo, oid, &path, before)
}

/// Files deleted in past commits that are not in the notebook now.
#[tauri::command]
#[specta::specta]
pub fn list_deleted_files(
    state: State<'_, AppState>,
    notebook_id: String,
    limit: Option<u32>,
) -> AppResult<Vec<DeletedFile>> {
    let repo = git::open(&root(&state, &notebook_id)?)?;
    let limit = usize::try_from(limit.unwrap_or(200).clamp(1, 2000)).unwrap_or(200);
    git::history::deleted_files(&repo, limit)
}

/// Writes `path` as stored in `commit_id` (its first parent with `before`, which is where a
/// deleted file still exists) to `target`, or back to `path`. Returns the written path.
#[tauri::command]
#[specta::specta]
pub fn restore_file(
    state: State<'_, AppState>,
    notebook_id: String,
    commit_id: String,
    path: String,
    before: bool,
    target: Option<String>,
) -> AppResult<String> {
    let root = root(&state, &notebook_id)?;
    let repo = git::open(&root)?;
    let path = notebook::paths::normalize(&path)?;
    let target = notebook::paths::normalize(target.as_deref().unwrap_or(&path))?;
    let bytes = git::history::file_bytes(&repo, Some(parse_oid(&commit_id)?), &path, before)?
        .ok_or_else(|| AppError::not_found(format!("{path} is not in that version")))?;
    let abs = notebook::paths::resolve(&root, &target)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    notebook::files::write_atomic(&abs, &bytes)?;
    Ok(target)
}
