use serde::Serialize;
use specta::Type;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::git::KnownHost;
use crate::secrets::{HttpsTokenInfo, SshKeyInfo};
use crate::state::{AppState, lock};

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretStoreStatus {
    pub available: bool,
    /// e.g. `secret-service`, `windows-credential-manager`, `android-keystore`.
    pub backend: String,
    pub error: Option<String>,
}

/// Everything the Credentials screen shows. Contains references only, never a secret.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsInfo {
    pub ssh_key: Option<SshKeyInfo>,
    pub https_tokens: Vec<HttpsTokenInfo>,
    pub known_hosts: Vec<KnownHost>,
    pub secret_store: SecretStoreStatus,
}

#[tauri::command]
#[specta::specta]
pub async fn get_credentials(state: State<'_, AppState>) -> AppResult<CredentialsInfo> {
    let config = state.credentials.clone();
    let secrets = state.secrets_handle();
    let known_hosts = state.host_keys.list();
    tokio::task::spawn_blocking(move || {
        let store = secrets.store();
        let config = lock(&config)?;
        Ok(CredentialsInfo {
            ssh_key: config.ssh_key().cloned(),
            https_tokens: config.https_tokens().to_vec(),
            known_hosts,
            secret_store: SecretStoreStatus {
                available: store.unavailable_reason().is_none(),
                backend: store.backend().to_owned(),
                error: store.unavailable_reason(),
            },
        })
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

/// Generates a new ed25519 key for this device, replacing any previous one.
#[tauri::command]
#[specta::specta]
pub async fn generate_ssh_key(state: State<'_, AppState>) -> AppResult<SshKeyInfo> {
    let device = lock(&state.settings)?.get().device_name.clone();
    let config = state.credentials.clone();
    let secrets = state.secrets_handle();
    tokio::task::spawn_blocking(move || {
        let store = secrets.store();
        lock(&config)?.generate_ssh_key(store.as_ref(), &format!("git-notes@{device}"))
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn delete_ssh_key(state: State<'_, AppState>) -> AppResult<()> {
    let config = state.credentials.clone();
    let secrets = state.secrets_handle();
    tokio::task::spawn_blocking(move || {
        let store = secrets.store();
        lock(&config)?.delete_ssh_key(store.as_ref())
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

/// Stores an HTTPS access token for `host`. The token goes straight into the OS store.
#[tauri::command]
#[specta::specta]
pub async fn save_https_token(
    state: State<'_, AppState>,
    host: String,
    username: String,
    token: String,
) -> AppResult<HttpsTokenInfo> {
    let config = state.credentials.clone();
    let secrets = state.secrets_handle();
    tokio::task::spawn_blocking(move || {
        let store = secrets.store();
        lock(&config)?.save_https_token(store.as_ref(), &host, &username, &token)
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn delete_https_token(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let config = state.credentials.clone();
    let secrets = state.secrets_handle();
    tokio::task::spawn_blocking(move || {
        let store = secrets.store();
        lock(&config)?.delete_https_token(store.as_ref(), &id)
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

/// Forgets a remembered SSH host key (after a legitimate server key change).
#[tauri::command]
#[specta::specta]
pub fn forget_host_key(state: State<'_, AppState>, host: String) -> AppResult<()> {
    state.host_keys.forget(&host)?;
    Ok(())
}
