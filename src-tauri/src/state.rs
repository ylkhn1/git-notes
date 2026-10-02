//! Process-wide state managed by Tauri and shared by all commands.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use tauri::Manager;
use tauri_specta::Event;

use crate::error::{AppError, AppResult};
use crate::git::HostKeyStore;
use crate::notebook::{NotebookWatcher, Registry};
use crate::secrets::{self, CredentialsConfig, SecretStore};
use crate::settings::SettingsStore;
use crate::sync::SyncEngine;

#[derive(Debug)]
pub struct AppState {
    pub registry: Mutex<Registry>,
    pub settings: Mutex<SettingsStore>,
    pub watchers: Mutex<HashMap<String, NotebookWatcher>>,
    /// Credential *references*; the secrets themselves are behind [`AppState::secrets`].
    pub credentials: Arc<Mutex<CredentialsConfig>>,
    pub secrets: Arc<LazySecretStore>,
    pub host_keys: Arc<HostKeyStore>,
    pub sync: Arc<SyncEngine>,
    /// Where new and cloned notebooks go unless the user picks another folder.
    pub default_notebooks_dir: PathBuf,
}

impl AppState {
    pub fn init<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<Self> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|e| AppError::internal(format!("no config dir: {e}")))?;
        std::fs::create_dir_all(&config_dir)?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::internal(format!("no data dir: {e}")))?;
        std::fs::create_dir_all(&data_dir)?;
        crate::git::configure(&data_dir);

        let default_notebooks_dir = default_notebooks_dir(app)?;

        let handle = app.clone();
        let sync = SyncEngine::new(Box::new(move |notebook_id, state| {
            let event = crate::commands::SyncStateChanged {
                notebook_id: notebook_id.to_owned(),
                state: state.clone(),
            };
            if let Err(error) = event.emit(&handle) {
                tracing::warn!(%error, "could not emit sync state");
            }
        }));

        Ok(Self {
            registry: Mutex::new(Registry::load(config_dir.join("notebooks.json"))?),
            settings: Mutex::new(SettingsStore::load(config_dir.join("settings.json"))?),
            watchers: Mutex::new(HashMap::new()),
            credentials: Arc::new(Mutex::new(CredentialsConfig::load(
                config_dir.join("credentials.json"),
            )?)),
            secrets: Arc::new(LazySecretStore::default()),
            host_keys: Arc::new(HostKeyStore::load(config_dir.join("known_hosts.json"))?),
            sync: Arc::new(sync),
            default_notebooks_dir,
        })
    }

    /// Handle that can be moved into a blocking task.
    pub fn secrets_handle(&self) -> Arc<LazySecretStore> {
        Arc::clone(&self.secrets)
    }
}

/// Opens the OS credential store on first use (not at startup: on Linux that may prompt to
/// unlock the wallet, and on Android it needs the JNI context to be ready).
#[derive(Debug, Default)]
pub struct LazySecretStore {
    inner: OnceLock<Arc<dyn SecretStore>>,
}

impl LazySecretStore {
    pub fn store(&self) -> Arc<dyn SecretStore> {
        Arc::clone(self.inner.get_or_init(secrets::platform_store))
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
