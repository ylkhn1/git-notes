use serde::Serialize;
use specta::Type;
use tauri::ipc::Channel;

use crate::apk_update::{ApkDownloadEvent, ApkInstallOutcome, ApkUpdate};
use crate::error::AppResult;
use crate::share::SharedContent;

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

/// Android: the release newer than this app, if any (desktop uses the updater plugin).
#[tauri::command]
#[specta::specta]
pub async fn check_apk_update(app: tauri::AppHandle) -> AppResult<Option<ApkUpdate>> {
    crate::apk_update::check(&app).await
}

/// Android: downloads the APK of `version` and opens the system installer for it.
#[tauri::command]
#[specta::specta]
pub async fn install_apk_update(
    app: tauri::AppHandle,
    version: String,
    on_event: Channel<ApkDownloadEvent>,
) -> AppResult<ApkInstallOutcome> {
    crate::apk_update::install(&app, &version, on_event).await
}

/// Android: opens the system installer again for the APK `install_apk_update` downloaded.
#[tauri::command]
#[specta::specta]
pub async fn launch_apk_installer(
    app: tauri::AppHandle,
    open_settings: bool,
) -> AppResult<ApkInstallOutcome> {
    crate::apk_update::launch_installer(&app, open_settings).await
}

/// Text another app shared with us (Android share sheet) since the last call, if any.
/// Always `None` on desktop.
#[tauri::command]
#[specta::specta]
pub fn take_shared_content(app: tauri::AppHandle) -> AppResult<Option<SharedContent>> {
    crate::share::take_shared(&app)
}
