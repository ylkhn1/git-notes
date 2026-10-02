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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: ThemeMode,
    pub editor_font: EditorFont,
    /// Editor body size in CSS pixels.
    pub editor_font_size: u8,
    /// Desktop sidebar width in CSS pixels.
    pub sidebar_width: u16,
    /// Notebook to reopen on launch.
    pub last_notebook_id: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemeMode::System,
            editor_font: EditorFont::Sans,
            editor_font_size: 17,
            sidebar_width: 260,
            last_notebook_id: None,
        }
    }
}

impl Settings {
    /// Clamps values to sane ranges so a hand-edited file cannot break the layout.
    pub fn sanitized(mut self) -> Self {
        self.editor_font_size = self.editor_font_size.clamp(12, 32);
        self.sidebar_width = self.sidebar_width.clamp(160, 600);
        self
    }
}

/// Lenient on-disk shape: every field optional so older or hand-edited files still load.
/// Kept separate from [`Settings`] so the TypeScript type has required fields.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SettingsFile {
    theme: Option<ThemeMode>,
    editor_font: Option<EditorFont>,
    editor_font_size: Option<u8>,
    sidebar_width: Option<u16>,
    last_notebook_id: Option<String>,
}

impl From<SettingsFile> for Settings {
    fn from(file: SettingsFile) -> Self {
        let defaults = Settings::default();
        Settings {
            theme: file.theme.unwrap_or(defaults.theme),
            editor_font: file.editor_font.unwrap_or(defaults.editor_font),
            editor_font_size: file.editor_font_size.unwrap_or(defaults.editor_font_size),
            sidebar_width: file.sidebar_width.unwrap_or(defaults.sidebar_width),
            last_notebook_id: file.last_notebook_id,
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
                editor_font: EditorFont::Serif,
                editor_font_size: 99,
                sidebar_width: 10,
                last_notebook_id: Some("abc".into()),
            })
            .unwrap()
            .clone();
        assert_eq!(updated.editor_font_size, 32);
        assert_eq!(updated.sidebar_width, 160);

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
        assert_eq!(s.get().editor_font_size, 17);
    }
}
