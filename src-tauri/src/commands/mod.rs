//! Thin `#[tauri::command]` layer. No business logic here — delegate to the domain modules.

use serde::Serialize;
use specta::Type;

use crate::error::AppResult;

/// Static information about the running app, used by the About/diagnostics UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub device_name: String,
    pub libgit2_version: String,
    pub debug: bool,
}

#[tauri::command]
#[specta::specta]
pub fn get_app_info(app: tauri::AppHandle) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        device_name: crate::device::device_name(),
        libgit2_version: crate::git::libgit2_version(),
        debug: cfg!(debug_assertions),
    })
}
