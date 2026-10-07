//! In-app updates for the Android APK.
//!
//! The Tauri updater plugin is desktop-only, so Android has its own small path: the release
//! manifest (`latest.json`, the same file the desktop updater reads) says which version is
//! current, and the APK attached to that GitHub release is downloaded and handed to the
//! system package installer by `ApkUpdatePlugin.kt` in the generated Android project. The
//! installer only accepts an APK signed with the same key as the installed app, which is
//! what authenticates the download. Other platforms answer "not supported".

use serde::{Deserialize, Serialize};
use specta::Type;

#[cfg(target_os = "android")]
use crate::error::AppError;
use crate::error::AppResult;

/// Android package of the app, where the Kotlin plugin class lives.
#[cfg(target_os = "android")]
const ANDROID_PACKAGE: &str = "com.ylkhn.gitnotes";

/// GitHub releases of the app; the manifest and the APKs are assets of these releases.
const RELEASES_URL: &str = "https://github.com/ylkhn1/git-notes/releases";

/// A newer release than the running app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ApkUpdate {
    pub version: String,
    pub current_version: String,
    /// RFC 3339 publish date, when the manifest has one.
    pub date: Option<String>,
    /// Release notes from the manifest.
    pub notes: Option<String>,
}

/// Download progress, sent by the Kotlin side over the channel passed to
/// `install_apk_update`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum ApkDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<f64> },
    #[serde(rename_all = "camelCase")]
    Progress { downloaded: f64 },
}

/// What happened when the downloaded APK was handed to the system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ApkInstallOutcome {
    /// The system installer is showing its confirmation screen.
    Started,
    /// The user first has to allow git-notes to install apps (Android 8+); the settings
    /// screen for that was opened when asked to.
    NeedsPermission,
}

/// The parts of `latest.json` this module reads.
#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

/// URL of the release manifest of the latest published release.
#[cfg_attr(not(any(test, target_os = "android")), allow(dead_code))]
fn manifest_url() -> String {
    format!("{RELEASES_URL}/latest/download/latest.json")
}

/// URL of the APK the release workflow attaches to the release of `version`.
#[cfg_attr(not(any(test, target_os = "android")), allow(dead_code))]
fn apk_url(version: &str) -> String {
    format!("{RELEASES_URL}/download/v{version}/git-notes_{version}_android.apk")
}

/// `major.minor.patch` of a release version (an optional leading `v` is ignored). Anything
/// else, pre-releases included, is not a version this updater offers.
fn parse_version(text: &str) -> Option<[u64; 3]> {
    let text = text.trim();
    let text = text.strip_prefix('v').unwrap_or(text);
    let mut parts = text.split('.');
    let mut version = [0; 3];
    for slot in &mut version {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *slot = part.parse().ok()?;
    }
    parts.next().is_none().then_some(version)
}

fn format_version(version: [u64; 3]) -> String {
    format!("{}.{}.{}", version[0], version[1], version[2])
}

/// The update `manifest` announces over `current`, if it is newer.
#[cfg_attr(not(any(test, target_os = "android")), allow(dead_code))]
fn update_from_manifest(manifest: Manifest, current: [u64; 3]) -> Option<ApkUpdate> {
    let version = parse_version(&manifest.version)?;
    (version > current).then(|| ApkUpdate {
        version: format_version(version),
        current_version: format_version(current),
        date: manifest.pub_date,
        notes: manifest.notes.filter(|notes| !notes.trim().is_empty()),
    })
}

/// The Tauri plugin that registers the Android side. A no-op elsewhere.
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("apk-update")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = api.register_android_plugin(ANDROID_PACKAGE, "ApkUpdatePlugin")?;
                app.manage(ApkUpdateHandle(handle));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
struct ApkUpdateHandle<R: tauri::Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
impl<R: tauri::Runtime> std::fmt::Debug for ApkUpdateHandle<R> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApkUpdateHandle").finish_non_exhaustive()
    }
}

/// Runs a Kotlin plugin command off the async runtime: the call blocks until Kotlin
/// resolves, which for a download takes a while.
#[cfg(target_os = "android")]
async fn run_plugin<R, T>(
    app: &tauri::AppHandle<R>,
    command: &'static str,
    payload: serde_json::Value,
) -> AppResult<T>
where
    R: tauri::Runtime,
    T: serde::de::DeserializeOwned + Send + 'static,
{
    use tauri::Manager;

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let handle = app
            .try_state::<ApkUpdateHandle<R>>()
            .ok_or_else(|| AppError::internal("the update plugin is not loaded"))?;
        handle
            .0
            .run_mobile_plugin(command, payload)
            .map_err(|e| AppError::internal(e.to_string()))
    })
    .await
    .map_err(|e| AppError::internal(format!("update task failed: {e}")))?
}

#[cfg(not(target_os = "android"))]
fn unsupported<T>() -> AppResult<T> {
    Err(crate::error::AppError::invalid_input(
        "APK updates are only available on Android",
    ))
}

/// Reads the release manifest and returns the newer release, if there is one.
pub async fn check<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<Option<ApkUpdate>> {
    #[cfg(target_os = "android")]
    {
        #[derive(Deserialize)]
        struct Response {
            text: String,
        }

        let version = &app.package_info().version;
        let current = [version.major, version.minor, version.patch];
        let response: Response = run_plugin(
            app,
            "fetchText",
            serde_json::json!({ "url": manifest_url() }),
        )
        .await?;
        let manifest: Manifest = serde_json::from_str(&response.text)
            .map_err(|e| AppError::internal(format!("unreadable release manifest: {e}")))?;
        Ok(update_from_manifest(manifest, current))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        unsupported()
    }
}

/// Downloads the APK of `version` (the Kotlin side reports progress on `on_event`) and
/// opens the system installer for it.
pub async fn install<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    version: &str,
    on_event: tauri::ipc::Channel<ApkDownloadEvent>,
) -> AppResult<ApkInstallOutcome> {
    // The version goes into a URL, so only plain release versions are accepted.
    let version = parse_version(version).map(format_version).ok_or_else(|| {
        crate::error::AppError::invalid_input(format!("not a release version: {version}"))
    })?;
    #[cfg(target_os = "android")]
    {
        let payload = serde_json::json!({ "url": apk_url(&version), "onProgress": on_event });
        run_plugin::<R, serde_json::Value>(app, "download", payload).await?;
        launch_installer(app, true).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, version, on_event);
        unsupported()
    }
}

/// Opens the system installer for the APK downloaded by [`install`]. Without the
/// permission to install apps it opens that settings screen when `open_settings` is set.
pub async fn launch_installer<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    open_settings: bool,
) -> AppResult<ApkInstallOutcome> {
    #[cfg(target_os = "android")]
    {
        #[derive(Deserialize)]
        struct Response {
            outcome: ApkInstallOutcome,
        }

        let payload = serde_json::json!({ "openSettings": open_settings });
        let response: Response = run_plugin(app, "install", payload).await?;
        Ok(response.outcome)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, open_settings);
        unsupported()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(version: &str) -> Manifest {
        Manifest {
            version: version.to_owned(),
            notes: Some("Notes".to_owned()),
            pub_date: Some("2026-10-07T10:00:00Z".to_owned()),
        }
    }

    #[test]
    fn parses_release_versions_only() {
        assert_eq!(parse_version("0.2.1"), Some([0, 2, 1]));
        assert_eq!(parse_version("v1.10.0"), Some([1, 10, 0]));
        assert_eq!(parse_version(" 2.0.3\n"), Some([2, 0, 3]));
        for bad in [
            "",
            "1.2",
            "1.2.3.4",
            "1.2.3-beta.1",
            "1..3",
            "a.b.c",
            "1.2.+3",
            "1.2.3/x",
        ] {
            assert_eq!(parse_version(bad), None, "{bad}");
        }
    }

    #[test]
    fn offers_only_newer_versions() {
        let update = update_from_manifest(manifest("v0.3.0"), [0, 2, 1]).expect("newer");
        assert_eq!(update.version, "0.3.0");
        assert_eq!(update.current_version, "0.2.1");
        assert_eq!(update.notes.as_deref(), Some("Notes"));
        assert_eq!(update.date.as_deref(), Some("2026-10-07T10:00:00Z"));

        assert!(update_from_manifest(manifest("0.10.0"), [0, 9, 9]).is_some());
        assert!(update_from_manifest(manifest("0.2.1"), [0, 2, 1]).is_none());
        assert!(update_from_manifest(manifest("0.2.0"), [0, 2, 1]).is_none());
        assert!(update_from_manifest(manifest("0.3.0-rc.1"), [0, 2, 1]).is_none());
    }

    #[test]
    fn reads_the_tauri_manifest() {
        let text = r#"{"version":"0.2.1","notes":" ","pub_date":"2026-10-07T05:00:00.000Z",
            "platforms":{"linux-x86_64":{"signature":"s","url":"u"}}}"#;
        let manifest: Manifest = serde_json::from_str(text).expect("parse");
        let update = update_from_manifest(manifest, [0, 2, 0]).expect("newer");
        assert_eq!(update.notes, None, "blank notes are dropped");
    }

    #[test]
    fn release_urls() {
        assert_eq!(
            manifest_url(),
            "https://github.com/ylkhn1/git-notes/releases/latest/download/latest.json"
        );
        assert_eq!(
            apk_url("0.2.2"),
            "https://github.com/ylkhn1/git-notes/releases/download/v0.2.2/git-notes_0.2.2_android.apk"
        );
    }

    #[test]
    fn events_match_the_kotlin_side() {
        let event: ApkDownloadEvent =
            serde_json::from_str(r#"{"event":"started","data":{"contentLength":null}}"#)
                .expect("started");
        assert!(matches!(
            event,
            ApkDownloadEvent::Started {
                content_length: None
            }
        ));
        let event: ApkDownloadEvent =
            serde_json::from_str(r#"{"event":"progress","data":{"downloaded":1024}}"#)
                .expect("progress");
        assert!(matches!(event, ApkDownloadEvent::Progress { downloaded } if downloaded == 1024.0));
        let outcome: ApkInstallOutcome =
            serde_json::from_str(r#""needsPermission""#).expect("outcome");
        assert_eq!(outcome, ApkInstallOutcome::NeedsPermission);
    }
}
