//! Process-wide state managed by Tauri and shared by all commands.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use tauri::Manager;
use tauri_specta::Event;

use crate::error::{AppError, AppResult};
use crate::git::{Author, HostKeyStore};
use crate::notebook::{NotebookWatcher, Registry};
use crate::secrets::{self, ConfiguredCredentials, CredentialsConfig, SecretStore};
use crate::settings::{Settings, SettingsStore};
use crate::sync::{AutoSyncConfig, SyncContext, SyncEngine, SyncScheduler, SyncSource};

#[derive(Debug)]
pub struct AppState {
    pub registry: Mutex<Registry>,
    pub settings: Mutex<SettingsStore>,
    pub watchers: Mutex<HashMap<String, NotebookWatcher>>,
    /// Credential *references*; the secrets themselves are behind [`AppState::secrets`].
    pub credentials: Arc<Mutex<CredentialsConfig>>,
    pub secrets: Arc<LazySecretStore>,
    pub host_keys: Arc<HostKeyStore>,
    /// Automatic + manual sync; owns the [`SyncEngine`].
    pub sync: Arc<SyncScheduler>,
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

        let settings = SettingsStore::load(config_dir.join("settings.json"))?;

        let handle = app.clone();
        let engine = Arc::new(SyncEngine::new(Box::new(move |notebook_id, state| {
            let event = crate::commands::SyncStateChanged {
                notebook_id: notebook_id.to_owned(),
                state: state.clone(),
            };
            if let Err(error) = event.emit(&handle) {
                tracing::warn!(%error, "could not emit sync state");
            }
        })));
        let handle = app.clone();
        let sync = SyncScheduler::new(
            engine,
            Arc::new(AppSyncSource { app: app.clone() }),
            tauri::async_runtime::handle().inner().clone(),
            auto_sync_config(settings.get()),
            Box::new(move |notebook_id, plan| {
                let event = crate::commands::SyncPlanChanged {
                    notebook_id: notebook_id.to_owned(),
                    plan: plan.clone(),
                };
                if let Err(error) = event.emit(&handle) {
                    tracing::warn!(%error, "could not emit sync plan");
                }
            }),
        );

        Ok(Self {
            registry: Mutex::new(Registry::load(config_dir.join("notebooks.json"))?),
            settings: Mutex::new(settings),
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

    /// Root of a registered notebook.
    pub fn root(&self, notebook_id: &str) -> AppResult<PathBuf> {
        lock(&self.registry)?.root(notebook_id)
    }

    /// Author, device and credentials for a sync, from the current settings.
    pub fn sync_context(&self) -> AppResult<SyncContext> {
        let settings = lock(&self.settings)?.get().clone();
        let config = lock(&self.credentials)?;
        Ok(SyncContext {
            author: Author {
                name: settings.author_name,
                email: settings.author_email,
            },
            device: settings.device_name,
            credentials: Arc::new(ConfiguredCredentials::new(&config, self.secrets.store())),
            hosts: Arc::clone(&self.host_keys),
        })
    }
}

/// The scheduler's view of the app: resolves a notebook id when a sync is about to run, so
/// it always sees the current registry, settings and credentials.
struct AppSyncSource<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> SyncSource for AppSyncSource<R> {
    fn prepare(&self, notebook_id: &str) -> AppResult<(PathBuf, SyncContext)> {
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or_else(|| AppError::internal("application state is not ready"))?;
        Ok((state.root(notebook_id)?, state.sync_context()?))
    }
}

/// Scheduler settings derived from the user settings.
pub fn auto_sync_config(settings: &Settings) -> AutoSyncConfig {
    AutoSyncConfig {
        enabled: settings.auto_sync,
        debounce: std::time::Duration::from_secs(u64::from(settings.auto_sync_delay_secs)),
        ..AutoSyncConfig::default()
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
