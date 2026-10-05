//! One-time migration of per-user files from the placeholder bundle identifier
//! (`com.example.gitnotes`, used until Phase 4) to the final one.
//!
//! Tauri derives the config directory from the identifier, so the rename moved it. On the
//! first start with the new identifier the JSON files are copied over if the new directory
//! is still empty; the old directory is left untouched. Secrets are keyed by the identifier
//! too and are moved lazily by the secret store (see `secrets::keyring_store`), because
//! opening the OS keyring at start-up may prompt the user.

use std::path::{Path, PathBuf};

use crate::error::AppResult;

/// Identifier the app shipped with before `com.ylkhn.gitnotes`.
pub const LEGACY_IDENTIFIER: &str = "com.example.gitnotes";

/// Files in the config directory worth carrying over.
pub const CONFIG_FILES: [&str; 4] = [
    "settings.json",
    "notebooks.json",
    "credentials.json",
    "known_hosts.json",
];

/// What the config migration did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Migration {
    /// Files copied into the new config directory.
    pub copied: Vec<&'static str>,
    /// Where they came from.
    pub from: Option<PathBuf>,
}

impl Migration {
    /// Secrets referenced by `credentials.json` need moving too.
    pub fn credentials_copied(&self) -> bool {
        self.copied.contains(&"credentials.json")
    }
}

/// Copies the legacy config files into `config_dir` when it holds none of them yet.
pub fn migrate_config_dir(config_dir: &Path) -> AppResult<Migration> {
    let Some(legacy) = legacy_config_dir(config_dir) else {
        return Ok(Migration::default());
    };
    if !legacy.is_dir() || CONFIG_FILES.iter().any(|f| config_dir.join(f).exists()) {
        return Ok(Migration::default());
    }
    std::fs::create_dir_all(config_dir)?;
    let mut copied = Vec::new();
    for name in CONFIG_FILES {
        let source = legacy.join(name);
        if source.is_file() {
            std::fs::copy(&source, config_dir.join(name))?;
            copied.push(name);
        }
    }
    if !copied.is_empty() {
        tracing::info!(from = %legacy.display(), ?copied, "migrated config from the legacy identifier");
    }
    Ok(Migration {
        copied,
        from: Some(legacy),
    })
}

/// `…/com.ylkhn.gitnotes` → `…/com.example.gitnotes`, or `None` when the directory is not
/// named after an identifier (tests, unusual platforms).
fn legacy_config_dir(config_dir: &Path) -> Option<PathBuf> {
    let name = config_dir.file_name()?.to_str()?;
    if name == LEGACY_IDENTIFIER || !name.contains('.') {
        return None;
    }
    Some(config_dir.parent()?.join(LEGACY_IDENTIFIER))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_files_once_into_an_empty_config_dir() {
        let base = tempfile::tempdir().unwrap();
        let legacy = base.path().join(LEGACY_IDENTIFIER);
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("settings.json"), "{}").unwrap();
        std::fs::write(legacy.join("credentials.json"), "{}").unwrap();
        std::fs::write(legacy.join("unrelated.txt"), "x").unwrap();
        let new = base.path().join("com.ylkhn.gitnotes");

        let done = migrate_config_dir(&new).unwrap();
        assert_eq!(done.copied, vec!["settings.json", "credentials.json"]);
        assert!(done.credentials_copied());
        assert_eq!(done.from.as_deref(), Some(legacy.as_path()));
        assert!(new.join("settings.json").is_file());
        assert!(!new.join("unrelated.txt").exists());
        assert!(
            legacy.join("settings.json").is_file(),
            "the old dir is kept"
        );

        // Second start: the new dir is populated, nothing happens even if files differ.
        std::fs::write(new.join("settings.json"), r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(migrate_config_dir(&new).unwrap(), Migration::default());
        assert_eq!(
            std::fs::read_to_string(new.join("settings.json")).unwrap(),
            r#"{"theme":"dark"}"#
        );
    }

    #[test]
    fn nothing_to_do_without_a_legacy_dir_or_for_odd_paths() {
        let base = tempfile::tempdir().unwrap();
        let new = base.path().join("com.ylkhn.gitnotes");
        assert_eq!(migrate_config_dir(&new).unwrap(), Migration::default());
        assert!(!new.exists(), "no directory is created for nothing");
        assert_eq!(
            migrate_config_dir(&base.path().join("plain-name")).unwrap(),
            Migration::default()
        );
        assert_eq!(
            migrate_config_dir(&base.path().join(LEGACY_IDENTIFIER)).unwrap(),
            Migration::default()
        );
    }
}
