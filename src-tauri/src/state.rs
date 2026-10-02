//! Process-wide state managed by Tauri and shared by all commands.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::notebook::{NotebookWatcher, Registry};
use crate::settings::SettingsStore;

#[derive(Debug)]
pub struct AppState {
    pub registry: Mutex<Registry>,
    pub settings: Mutex<SettingsStore>,
    pub watchers: Mutex<HashMap<String, NotebookWatcher>>,
    /// Where new notebooks are created unless the user picks another folder.
    pub default_notebooks_dir: PathBuf,
}

impl AppState {
    pub fn init<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<Self> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|e| AppError::internal(format!("no config dir: {e}")))?;
        std::fs::create_dir_all(&config_dir)?;

        let default_notebooks_dir = default_notebooks_dir(app)?;

        Ok(Self {
            registry: Mutex::new(Registry::load(config_dir.join("notebooks.json"))?),
            settings: Mutex::new(SettingsStore::load(config_dir.join("settings.json"))?),
            watchers: Mutex::new(HashMap::new()),
            default_notebooks_dir,
        })
    }
}

/// On mobile libgit2 cannot work through the Storage Access Framework, so notebooks must
/// live in the app's private data directory. On desktop `~/Notes` is a friendlier default.
fn default_notebooks_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<PathBuf> {
    let path = app.path();
    if cfg!(any(target_os = "android", target_os = "ios")) {
        path.app_data_dir()
            .map(|d| d.join("notebooks"))
            .map_err(|e| AppError::internal(format!("no data dir: {e}")))
    } else {
        path.home_dir()
            .map(|d| d.join("Notes"))
            .map_err(|e| AppError::internal(format!("no home dir: {e}")))
    }
}

/// Locks a mutex, converting poisoning into an `AppError` instead of panicking.
pub fn lock<T>(mutex: &Mutex<T>) -> AppResult<MutexGuard<'_, T>> {
    mutex
        .lock()
        .map_err(|_| AppError::internal("application state is poisoned"))
}
