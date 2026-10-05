//! User settings persisted as JSON in the app config directory.
//!
//! Secrets never live here (see [`crate::secrets`]); this is UI preferences and references.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EditorFont {
    #[default]
    Sans,
    Serif,
    Mono,
}

/// UI language. `System` follows the OS / webview locale and falls back to English.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    #[default]
    System,
    En,
    Ru,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: ThemeMode,
    /// Language of the user interface.
    pub language: Language,
    pub editor_font: EditorFont,
    /// Editor body size in CSS pixels.
    pub editor_font_size: u8,
    /// Desktop sidebar width in CSS pixels.
    pub sidebar_width: u16,
    /// Notebook to reopen on launch.
    pub last_notebook_id: Option<String>,
    /// Commit author. Set explicitly here; the user's global git config is never read.
    pub author_name: String,
    pub author_email: String,
    /// Appears in sync commit messages and conflict copy names.
    pub device_name: String,
    /// Sync automatically after edits and when the app regains focus.
    pub auto_sync: bool,
    /// Quiet period after the last change before an automatic sync starts.
    pub auto_sync_delay_secs: u32,
    /// Also sync every N minutes while a notebook is open, so changes made on other devices
    /// arrive without a local edit or a focus change. `0` turns this off.
    pub periodic_sync_mins: u32,
    /// Look for a new release on start-up and every few hours (desktop only).
    pub check_updates: bool,
    /// The first-run flow was finished or skipped.
    pub onboarding_complete: bool,
}

/// Default debounce for automatic sync, per the project brief.
pub const DEFAULT_AUTO_SYNC_DELAY_SECS: u32 = 30;
pub const MIN_AUTO_SYNC_DELAY_SECS: u32 = 5;
pub const MAX_AUTO_SYNC_DELAY_SECS: u32 = 3600;
/// Default interval of the periodic sync, in minutes.
pub const DEFAULT_PERIODIC_SYNC_MINS: u32 = 15;
pub const MAX_PERIODIC_SYNC_MINS: u32 = 24 * 60;

impl Default for Settings {
    fn default() -> Self {
        let device = crate::device::device_name();
        Self {
            theme: ThemeMode::System,
            language: Language::System,
            editor_font: EditorFont::Sans,
            editor_font_size: 17,
            sidebar_width: 260,
            last_notebook_id: None,
            author_name: device.clone(),
            author_email: default_email(&device),
            device_name: device,
            auto_sync: true,
            auto_sync_delay_secs: DEFAULT_AUTO_SYNC_DELAY_SECS,
            periodic_sync_mins: DEFAULT_PERIODIC_SYNC_MINS,
            check_updates: true,
            onboarding_complete: false,
        }
    }
}

fn default_email(device: &str) -> String {
    format!("{}@git-notes.local", device.to_ascii_lowercase())
}

impl Settings {
    /// Clamps values to sane ranges so a hand-edited file cannot break the layout, and fills
    /// empty identity fields with device-based defaults.
    pub fn sanitized(mut self) -> Self {
        self.editor_font_size = self.editor_font_size.clamp(12, 32);
        self.sidebar_width = self.sidebar_width.clamp(160, 600);
        self.auto_sync_delay_secs = self
            .auto_sync_delay_secs
            .clamp(MIN_AUTO_SYNC_DELAY_SECS, MAX_AUTO_SYNC_DELAY_SECS);
        self.periodic_sync_mins = self.periodic_sync_mins.min(MAX_PERIODIC_SYNC_MINS);
        self.device_name = crate::device::sanitize(self.device_name.trim());
        if self.device_name.is_empty() {
            self.device_name = crate::device::device_name();
        }
        self.author_name = self.author_name.trim().to_owned();
        if self.author_name.is_empty() {
            self.author_name = self.device_name.clone();
        }
        self.author_email = self.author_email.trim().to_owned();
        if self.author_email.is_empty() {
            self.author_email = default_email(&self.device_name);
        }
        self
    }
}

/// Lenient on-disk shape: every field optional so older or hand-edited files still load.
/// Kept separate from [`Settings`] so the TypeScript type has required fields.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SettingsFile {
    theme: Option<ThemeMode>,
    language: Option<Language>,
    editor_font: Option<EditorFont>,
    editor_font_size: Option<u8>,
    sidebar_width: Option<u16>,
    last_notebook_id: Option<String>,
    author_name: Option<String>,
    author_email: Option<String>,
    device_name: Option<String>,
    auto_sync: Option<bool>,
    auto_sync_delay_secs: Option<u32>,
    periodic_sync_mins: Option<u32>,
    check_updates: Option<bool>,
    onboarding_complete: Option<bool>,
}

impl From<SettingsFile> for Settings {
    fn from(file: SettingsFile) -> Self {
        let defaults = Settings::default();
        Settings {
            theme: file.theme.unwrap_or(defaults.theme),
            language: file.language.unwrap_or(defaults.language),
            editor_font: file.editor_font.unwrap_or(defaults.editor_font),
            editor_font_size: file.editor_font_size.unwrap_or(defaults.editor_font_size),
            sidebar_width: file.sidebar_width.unwrap_or(defaults.sidebar_width),
            last_notebook_id: file.last_notebook_id,
            author_name: file.author_name.unwrap_or(defaults.author_name),
            author_email: file.author_email.unwrap_or(defaults.author_email),
            device_name: file.device_name.unwrap_or(defaults.device_name),
            auto_sync: file.auto_sync.unwrap_or(defaults.auto_sync),
            auto_sync_delay_secs: file
                .auto_sync_delay_secs
                .unwrap_or(defaults.auto_sync_delay_secs),
            periodic_sync_mins: file
                .periodic_sync_mins
                .unwrap_or(defaults.periodic_sync_mins),
            check_updates: file.check_updates.unwrap_or(defaults.check_updates),
            onboarding_complete: file
                .onboarding_complete
                .unwrap_or(defaults.onboarding_complete),
        }
    }
}

/// Settings plus the file they are stored in.
#[derive(Debug)]
pub struct SettingsStore {
    file: PathBuf,
    settings: Settings,
}

impl SettingsStore {
    pub fn load(file: PathBuf) -> AppResult<Self> {
        let settings = match std::fs::read_to_string(&file) {
            Ok(text) => Settings::from(
                serde_json::from_str::<SettingsFile>(&text)
                    .map_err(|e| AppError::internal(format!("corrupt settings.json: {e}")))?,
            )
            .sanitized(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self { file, settings })
    }

    pub fn get(&self) -> &Settings {
        &self.settings
    }

    pub fn update(&mut self, settings: Settings) -> AppResult<&Settings> {
        self.settings = settings.sanitized();
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(&self.settings)
            .map_err(|e| AppError::internal(e.to_string()))?;
        crate::notebook::files::write_atomic(&self.file, text.as_bytes())?;
        Ok(&self.settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_sanitize() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cfg/settings.json");
        let mut store = SettingsStore::load(file.clone()).unwrap();
        assert_eq!(*store.get(), Settings::default());

        let updated = store
            .update(Settings {
                theme: ThemeMode::Dark,
                language: Language::Ru,
                editor_font: EditorFont::Serif,
                editor_font_size: 99,
                sidebar_width: 10,
                last_notebook_id: Some("abc".into()),
                author_name: " Me ".into(),
                author_email: String::new(),
                device_name: "My Laptop".into(),
                auto_sync: false,
                auto_sync_delay_secs: 1,
                periodic_sync_mins: 99_999,
                check_updates: false,
                onboarding_complete: true,
            })
            .unwrap()
            .clone();
        assert_eq!(updated.language, Language::Ru);
        assert_eq!(updated.editor_font_size, 32);
        assert!(!updated.auto_sync);
        assert_eq!(updated.auto_sync_delay_secs, MIN_AUTO_SYNC_DELAY_SECS);
        assert_eq!(updated.periodic_sync_mins, MAX_PERIODIC_SYNC_MINS);
        assert!(!updated.check_updates);
        assert!(updated.onboarding_complete);
        assert_eq!(updated.sidebar_width, 160);
        assert_eq!(updated.author_name, "Me");
        assert_eq!(updated.device_name, "My-Laptop");
        assert_eq!(updated.author_email, "my-laptop@git-notes.local");

        let reloaded = SettingsStore::load(file).unwrap();
        assert_eq!(*reloaded.get(), updated);
    }

    #[test]
    fn missing_fields_use_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        std::fs::write(&file, r#"{"theme":"light"}"#).unwrap();
        let s = SettingsStore::load(file).unwrap();
        assert_eq!(s.get().theme, ThemeMode::Light);
        assert_eq!(s.get().language, Language::System);
        assert_eq!(s.get().editor_font_size, 17);
        assert!(s.get().auto_sync);
        assert_eq!(s.get().auto_sync_delay_secs, DEFAULT_AUTO_SYNC_DELAY_SECS);
        assert_eq!(s.get().periodic_sync_mins, DEFAULT_PERIODIC_SYNC_MINS);
        assert!(s.get().check_updates);
        assert!(!s.get().onboarding_complete);
    }

    #[test]
    fn periodic_sync_can_be_turned_off() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        std::fs::write(&file, r#"{"periodicSyncMins":0}"#).unwrap();
        assert_eq!(
            SettingsStore::load(file).unwrap().get().periodic_sync_mins,
            0
        );
    }
}
