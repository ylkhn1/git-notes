use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::error::{AppError, AppResult};
use crate::git::{
    self, Author, ChangedFile, CloneProgress, CloneStage, CommitInfo, FileDiff, RemoteUrl,
    RepoStatus,
};
use crate::notebook::{self, NotebookInfo};
use crate::secrets::ConfiguredCredentials;
use crate::state::{AppState, lock};
use crate::sync::{SyncContext, SyncReport, SyncState};

use super::notebook::root;

/// Emitted whenever a notebook's sync state changes.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SyncStateChanged {
    pub notebook_id: String,
    pub state: SyncState,
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

fn sync_context(state: &AppState) -> AppResult<SyncContext> {
    let settings = lock(&state.settings)?.get().clone();
    let config = lock(&state.credentials)?;
    Ok(SyncContext {
        author: Author {
            name: settings.author_name,
            email: settings.author_email,
        },
        device: settings.device_name,
        credentials: Arc::new(ConfiguredCredentials::new(&config, state.secrets.store())),
        hosts: Arc::clone(&state.host_keys),
    })
}

/// Runs one full sync now (single-flight per notebook).
#[tauri::command]
#[specta::specta]
pub async fn sync_now(state: State<'_, AppState>, notebook_id: String) -> AppResult<SyncReport> {
    let root = root(&state, &notebook_id)?;
    let ctx = sync_context(&state)?;
    Ok(state.sync.sync(&notebook_id, root, ctx).await)
}

#[tauri::command]
#[specta::specta]
pub fn get_sync_state(state: State<'_, AppState>, notebook_id: String) -> AppResult<SyncState> {
    Ok(state.sync.state(&notebook_id))
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

#[tauri::command]
#[specta::specta]
pub fn get_file_diff(
    state: State<'_, AppState>,
    notebook_id: String,
    commit_id: String,
    path: String,
) -> AppResult<FileDiff> {
    let repo = git::open(&root(&state, &notebook_id)?)?;
    let path = notebook::paths::normalize(&path)?;
    git::history::file_diff(&repo, parse_oid(&commit_id)?, &path)
}
