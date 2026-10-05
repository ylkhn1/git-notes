//! Text shared into the app from other apps.
//!
//! On Android the activity receives `ACTION_SEND` intents (see `SharePlugin.kt` in the
//! generated Android project); the Kotlin side keeps the last payload until the frontend
//! asks for it through [`take_shared`]. Other platforms have no share target and always
//! answer `None`.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::AppResult;

/// Android package of the app, where the Kotlin plugin class lives.
#[cfg(target_os = "android")]
const ANDROID_PACKAGE: &str = "com.ylkhn.gitnotes";

/// What another app shared with us.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SharedContent {
    /// The share sheet's subject (a page title, for example), if the sender set one.
    pub title: Option<String>,
    pub text: String,
}

/// The Tauri plugin that registers the Android side. A no-op elsewhere.
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("share")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = api.register_android_plugin(ANDROID_PACKAGE, "SharePlugin")?;
                app.manage(ShareHandle(handle));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
struct ShareHandle<R: tauri::Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
impl<R: tauri::Runtime> std::fmt::Debug for ShareHandle<R> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShareHandle").finish_non_exhaustive()
    }
}

/// Returns and clears the content shared into the app since the last call.
pub fn take_shared<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> AppResult<Option<SharedContent>> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;

        #[derive(Deserialize)]
        struct Response {
            shared: Option<SharedContent>,
        }

        let Some(handle) = app.try_state::<ShareHandle<R>>() else {
            return Ok(None);
        };
        let response: Response = handle
            .0
            .run_mobile_plugin("takeShared", ())
            .map_err(|e| crate::error::AppError::internal(format!("share plugin: {e}")))?;
        Ok(response.shared)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_shape_matches_the_kotlin_side() {
        let shared: SharedContent =
            serde_json::from_str(r#"{"title":null,"text":"hi"}"#).expect("parse");
        assert_eq!(shared.title, None);
        let shared: SharedContent =
            serde_json::from_str(r#"{"title":"T","text":"hi"}"#).expect("parse");
        assert_eq!(shared.title.as_deref(), Some("T"));
    }
}
