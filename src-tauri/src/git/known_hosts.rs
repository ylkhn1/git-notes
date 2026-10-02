//! Trust-on-first-use store for SSH host keys.
//!
//! Android has no `~/.ssh/known_hosts` and desktop users with a freshly generated in-app key
//! rarely have one either, so the app keeps its own list: the first key seen for a host is
//! remembered, a later *different* key is rejected until the user forgets the host.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,
    /// e.g. `ED25519`, `RSA`.
    pub key_type: String,
    /// `SHA256:` followed by unpadded base64, like OpenSSH prints it.
    pub fingerprint: String,
    #[specta(type = specta_typescript::Number)]
    pub first_seen_ms: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum HostKeyCheck {
    Known,
    FirstUse,
    Mismatch { stored: String },
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct KnownHostsFile {
    hosts: Vec<KnownHost>,
}

/// Thread-safe known-hosts list, optionally persisted to a JSON file.
#[derive(Debug)]
pub struct HostKeyStore {
    file: Option<PathBuf>,
    hosts: Mutex<Vec<KnownHost>>,
}

impl HostKeyStore {
    pub fn load(file: PathBuf) -> AppResult<Self> {
        let hosts = match std::fs::read_to_string(&file) {
            Ok(text) => {
                serde_json::from_str::<KnownHostsFile>(&text)
                    .map_err(|e| AppError::internal(format!("corrupt known_hosts.json: {e}")))?
                    .hosts
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            file: Some(file),
            hosts: Mutex::new(hosts),
        })
    }

    /// Store that forgets everything when dropped (tests, one-off operations).
    pub fn in_memory() -> Self {
        Self {
            file: None,
            hosts: Mutex::new(Vec::new()),
        }
    }

    pub fn list(&self) -> Vec<KnownHost> {
        self.hosts.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Compares the presented key with what is stored for `host`, remembering it on first use.
    pub fn check_and_remember(
        &self,
        host: &str,
        key_type: &str,
        fingerprint: &str,
    ) -> HostKeyCheck {
        let host = host.to_ascii_lowercase();
        let mut hosts = self.hosts.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(known) = hosts.iter().find(|h| h.host == host) {
            return if known.fingerprint == fingerprint {
                HostKeyCheck::Known
            } else {
                HostKeyCheck::Mismatch {
                    stored: known.fingerprint.clone(),
                }
            };
        }
        hosts.push(KnownHost {
            host,
            key_type: key_type.to_owned(),
            fingerprint: fingerprint.to_owned(),
            first_seen_ms: super::time::LocalTime::now().unix_ms(),
        });
        if let Err(error) = self.save(&hosts) {
            tracing::warn!(%error, "could not persist known hosts");
        }
        HostKeyCheck::FirstUse
    }

    /// Removes the stored key for `host`. Returns whether anything was removed.
    pub fn forget(&self, host: &str) -> AppResult<bool> {
        let host = host.to_ascii_lowercase();
        let mut hosts = self.hosts.lock().unwrap_or_else(|e| e.into_inner());
        let before = hosts.len();
        hosts.retain(|h| h.host != host);
        let removed = hosts.len() != before;
        if removed {
            self.save(&hosts)?;
        }
        Ok(removed)
    }

    fn save(&self, hosts: &[KnownHost]) -> AppResult<()> {
        let Some(file) = &self.file else {
            return Ok(());
        };
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(&KnownHostsFile {
            hosts: hosts.to_vec(),
        })
        .map_err(|e| AppError::internal(e.to_string()))?;
        crate::notebook::files::write_atomic(file, text.as_bytes())
    }
}

/// OpenSSH-style fingerprint of a raw SHA-256 host key hash.
pub fn fingerprint_sha256(hash: &[u8; 32]) -> String {
    format!("SHA256:{}", base64_unpadded(hash))
}

fn base64_unpadded(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let count = chunk.len() + 1;
        for i in 0..count {
            let index = ((n >> (18 - 6 * i)) & 0x3f) as usize;
            out.push(char::from(TABLE[index]));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_openssh_style() {
        assert_eq!(base64_unpadded(b""), "");
        assert_eq!(base64_unpadded(b"f"), "Zg");
        assert_eq!(base64_unpadded(b"fo"), "Zm8");
        assert_eq!(base64_unpadded(b"foo"), "Zm9v");
        assert_eq!(base64_unpadded(b"foobar"), "Zm9vYmFy");
        assert_eq!(fingerprint_sha256(&[0u8; 32]).len(), "SHA256:".len() + 43);
    }

    #[test]
    fn tofu_flow_and_persistence() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cfg/known_hosts.json");
        let store = HostKeyStore::load(file.clone()).unwrap();

        assert_eq!(
            store.check_and_remember("GitHub.com", "ED25519", "SHA256:aaa"),
            HostKeyCheck::FirstUse
        );
        assert_eq!(
            store.check_and_remember("github.com", "ED25519", "SHA256:aaa"),
            HostKeyCheck::Known
        );
        assert_eq!(
            store.check_and_remember("github.com", "RSA", "SHA256:bbb"),
            HostKeyCheck::Mismatch {
                stored: "SHA256:aaa".into()
            }
        );

        let reloaded = HostKeyStore::load(file).unwrap();
        assert_eq!(reloaded.list().len(), 1);
        assert_eq!(reloaded.list()[0].host, "github.com");

        assert!(reloaded.forget("github.com").unwrap());
        assert!(!reloaded.forget("github.com").unwrap());
        assert_eq!(
            reloaded.check_and_remember("github.com", "RSA", "SHA256:bbb"),
            HostKeyCheck::FirstUse
        );
    }
}
