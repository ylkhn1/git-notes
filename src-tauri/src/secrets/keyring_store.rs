//! [`SecretStore`] on top of the keyring ecosystem (`keyring-core` + a platform store).

use crate::error::{AppError, AppResult};

use super::SecretStore;

/// Service name under which the app's secrets appear in the OS credential store.
pub const SERVICE: &str = "com.example.gitnotes";

#[derive(Debug)]
pub struct KeyringStore {
    backend: &'static str,
}

/// Opens the platform credential store and installs it as the keyring default.
pub fn open() -> AppResult<KeyringStore> {
    #[cfg(target_os = "android")]
    {
        // Needs the `ndk-context` set up by tao/Tauri before the first call.
        let store = android_native_keyring_store::Store::new()
            .map_err(|e| AppError::secrets(format!("Android Keystore unavailable: {e}")))?;
        keyring_core::set_default_store(store);
        Ok(KeyringStore {
            backend: "android-keystore",
        })
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        keyring::Entry::store_status()
            .as_ref()
            .map_err(|e| AppError::secrets(format!("system keyring unavailable: {e}")))?;
        Ok(KeyringStore {
            backend: if cfg!(target_os = "windows") {
                "windows-credential-manager"
            } else if cfg!(target_os = "macos") {
                "keychain"
            } else {
                "secret-service"
            },
        })
    }
    #[cfg(target_os = "ios")]
    {
        Err(AppError::secrets("no secret store on this platform"))
    }
}

fn entry(id: &str) -> AppResult<keyring_core::Entry> {
    keyring_core::Entry::new(SERVICE, id).map_err(map_error)
}

fn map_error(error: keyring_core::Error) -> AppError {
    AppError::secrets(format!("credential store: {error}"))
}

impl SecretStore for KeyringStore {
    fn get(&self, id: &str) -> AppResult<Option<String>> {
        match entry(id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(map_error(error)),
        }
    }

    fn set(&self, id: &str, secret: &str) -> AppResult<()> {
        entry(id)?.set_password(secret).map_err(map_error)
    }

    fn delete(&self, id: &str) -> AppResult<()> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(map_error(error)),
        }
    }

    fn backend(&self) -> &'static str {
        self.backend
    }
}
