//! Secret storage. Config files only ever hold a *reference id*; the secret itself (SSH
//! private key, HTTPS token) lives behind [`SecretStore`] in the OS credential store:
//! Secret Service (KWallet / gnome-keyring) on Linux, Credential Manager on Windows, the
//! Keystore-backed store on Android.

pub mod config;
pub mod keyring_store;

pub use config::{ConfiguredCredentials, CredentialsConfig, HttpsTokenInfo, SshKeyInfo};

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};

use crate::error::{AppError, AppResult};

pub trait SecretStore: Send + Sync + fmt::Debug {
    /// Returns the secret for `id`, or `None` if it was never stored.
    fn get(&self, id: &str) -> AppResult<Option<String>>;
    fn set(&self, id: &str, secret: &str) -> AppResult<()>;
    /// Deleting a missing secret is not an error.
    fn delete(&self, id: &str) -> AppResult<()>;
    /// Short name for diagnostics, e.g. `secret-service`.
    fn backend(&self) -> &'static str;
    /// Why the store cannot be used, if it cannot.
    fn unavailable_reason(&self) -> Option<String> {
        None
    }
}

/// The platform store, or a stand-in that reports why none is available.
pub fn platform_store() -> Arc<dyn SecretStore> {
    match keyring_store::open() {
        Ok(store) => {
            tracing::info!(backend = store.backend(), "secret store ready");
            Arc::new(store)
        }
        Err(error) => {
            tracing::warn!(%error, "no secret store available");
            Arc::new(UnavailableSecretStore {
                reason: error.to_string(),
            })
        }
    }
}

/// In-memory store for tests. Secrets never appear in its `Debug` output.
#[derive(Default)]
pub struct MemorySecretStore {
    entries: Mutex<HashMap<String, String>>,
}

impl fmt::Debug for MemorySecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self
            .entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len();
        write!(f, "MemorySecretStore({count} entries)")
    }
}

impl SecretStore for MemorySecretStore {
    fn get(&self, id: &str) -> AppResult<Option<String>> {
        Ok(self
            .entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(id)
            .cloned())
    }

    fn set(&self, id: &str, secret: &str) -> AppResult<()> {
        self.entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, id: &str) -> AppResult<()> {
        self.entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(id);
        Ok(())
    }

    fn backend(&self) -> &'static str {
        "memory"
    }
}

/// Used when the OS store could not be opened; every operation fails with the reason.
#[derive(Debug)]
pub struct UnavailableSecretStore {
    reason: String,
}

impl SecretStore for UnavailableSecretStore {
    fn get(&self, _id: &str) -> AppResult<Option<String>> {
        Err(AppError::secrets(&self.reason))
    }

    fn set(&self, _id: &str, _secret: &str) -> AppResult<()> {
        Err(AppError::secrets(&self.reason))
    }

    fn delete(&self, _id: &str) -> AppResult<()> {
        Err(AppError::secrets(&self.reason))
    }

    fn backend(&self) -> &'static str {
        "unavailable"
    }

    fn unavailable_reason(&self) -> Option<String> {
        Some(self.reason.clone())
    }
}

/// Random identifier such as `ssh-key-3f9a…`; the only thing config files know about a secret.
pub fn random_id(prefix: &str) -> String {
    use ssh_key::rand_core::{OsRng, RngCore};
    let mut bytes = [0u8; 12];
    OsRng.fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{prefix}-{hex}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_roundtrip_and_redaction() {
        let store = MemorySecretStore::default();
        assert_eq!(store.get("a").unwrap(), None);
        store.set("a", "hunter2").unwrap();
        assert_eq!(store.get("a").unwrap().as_deref(), Some("hunter2"));
        assert!(!format!("{store:?}").contains("hunter2"));
        store.delete("a").unwrap();
        store.delete("a").unwrap();
        assert_eq!(store.get("a").unwrap(), None);
    }

    #[test]
    fn ids_are_unique_and_prefixed() {
        let a = random_id("ssh-key");
        let b = random_id("ssh-key");
        assert!(a.starts_with("ssh-key-"));
        assert_eq!(a.len(), "ssh-key-".len() + 24);
        assert_ne!(a, b);
    }

    #[test]
    fn unavailable_store_reports_reason() {
        let store = UnavailableSecretStore {
            reason: "no Secret Service".into(),
        };
        let error = store.set("x", "y").unwrap_err();
        assert!(
            matches!(error, AppError::Secrets { ref message } if message.contains("Secret Service"))
        );
    }
}
