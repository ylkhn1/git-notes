//! Secret storage abstraction. Implementations arrive in Phase 2:
//! desktop → OS keyring (`keyring` crate), Android → Keystore-backed Tauri plugin.
//!
//! Config files only ever store a *reference ID*; the secret itself lives behind this trait.

use crate::error::AppResult;

pub trait SecretStore: Send + Sync {
    /// Returns the secret for `id`, or `None` if it was never stored.
    fn get(&self, id: &str) -> AppResult<Option<String>>;
    fn set(&self, id: &str, secret: &str) -> AppResult<()>;
    fn delete(&self, id: &str) -> AppResult<()>;
}
