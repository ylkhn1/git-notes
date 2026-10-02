//! Credential *references* (`credentials.json`) and the provider that turns a remote URL
//! into credentials by looking the secrets up in the [`SecretStore`].

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use specta::Type;
use ssh_key::rand_core::OsRng;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};

use crate::error::{AppError, AppResult};
use crate::git::auth::{CredentialProvider, Credentials};
use crate::git::time::LocalTime;
use crate::git::url::{RemoteUrl, Transport};

use super::{SecretStore, random_id};

/// The device's SSH identity. The private key lives in the secret store under `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    pub id: String,
    /// `ssh-ed25519 AAAA… comment` — what the user adds to their git host.
    pub public_key: String,
    /// `SHA256:…`
    pub fingerprint: String,
    #[specta(type = specta_typescript::Number)]
    pub created_ms: i64,
}

/// An HTTPS access token for one host. The token itself lives in the secret store under `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpsTokenInfo {
    pub id: String,
    /// Lower-case host name, e.g. `github.com`.
    pub host: String,
    pub username: String,
    #[specta(type = specta_typescript::Number)]
    pub created_ms: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct CredentialsFile {
    ssh_key: Option<SshKeyInfo>,
    https_tokens: Vec<HttpsTokenInfo>,
}

/// Which credentials exist. Never contains a secret.
#[derive(Debug)]
pub struct CredentialsConfig {
    file: Option<PathBuf>,
    ssh_key: Option<SshKeyInfo>,
    https_tokens: Vec<HttpsTokenInfo>,
}

impl CredentialsConfig {
    pub fn load(file: PathBuf) -> AppResult<Self> {
        let data = match std::fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str::<CredentialsFile>(&text)
                .map_err(|e| AppError::internal(format!("corrupt credentials.json: {e}")))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => CredentialsFile::default(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            file: Some(file),
            ssh_key: data.ssh_key,
            https_tokens: data.https_tokens,
        })
    }

    pub fn in_memory() -> Self {
        Self {
            file: None,
            ssh_key: None,
            https_tokens: Vec::new(),
        }
    }

    pub fn ssh_key(&self) -> Option<&SshKeyInfo> {
        self.ssh_key.as_ref()
    }

    pub fn https_tokens(&self) -> &[HttpsTokenInfo] {
        &self.https_tokens
    }

    pub fn token_for_host(&self, host: &str) -> Option<&HttpsTokenInfo> {
        let host = host.to_ascii_lowercase();
        self.https_tokens.iter().find(|t| t.host == host)
    }

    /// Generates a fresh ed25519 key, stores the private half and replaces any previous key.
    pub fn generate_ssh_key(
        &mut self,
        store: &dyn SecretStore,
        comment: &str,
    ) -> AppResult<SshKeyInfo> {
        let mut key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
            .map_err(|e| AppError::internal(format!("key generation failed: {e}")))?;
        key.set_comment(comment);
        let private_pem = key
            .to_openssh(LineEnding::LF)
            .map_err(|e| AppError::internal(format!("key encoding failed: {e}")))?;
        let public_key = key
            .public_key()
            .to_openssh()
            .map_err(|e| AppError::internal(format!("public key encoding failed: {e}")))?;
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();

        let info = SshKeyInfo {
            id: random_id("ssh-key"),
            public_key,
            fingerprint,
            created_ms: LocalTime::now().unix_ms(),
        };
        // Store the secret first: if that fails nothing in the config changes.
        store.set(&info.id, &private_pem)?;
        let previous = self.ssh_key.replace(info.clone());
        self.save()?;
        if let Some(previous) = previous {
            let _ = store.delete(&previous.id);
        }
        Ok(info)
    }

    pub fn delete_ssh_key(&mut self, store: &dyn SecretStore) -> AppResult<()> {
        if let Some(previous) = self.ssh_key.take() {
            self.save()?;
            store.delete(&previous.id)?;
        }
        Ok(())
    }

    /// Saves a token for `host`, replacing an existing one for the same host.
    pub fn save_https_token(
        &mut self,
        store: &dyn SecretStore,
        host: &str,
        username: &str,
        token: &str,
    ) -> AppResult<HttpsTokenInfo> {
        let host = host.trim().trim_end_matches('/').to_ascii_lowercase();
        let host = host
            .strip_prefix("https://")
            .or_else(|| host.strip_prefix("http://"))
            .unwrap_or(&host)
            .split('/')
            .next()
            .unwrap_or_default()
            .to_owned();
        if host.is_empty() || host.contains(char::is_whitespace) {
            return Err(AppError::invalid_input("host must look like github.com"));
        }
        if token.trim().is_empty() {
            return Err(AppError::invalid_input("token must not be empty"));
        }
        let info = HttpsTokenInfo {
            id: random_id("https-token"),
            host: host.clone(),
            username: username.trim().to_owned(),
            created_ms: LocalTime::now().unix_ms(),
        };
        store.set(&info.id, token.trim())?;
        let previous: Vec<HttpsTokenInfo> = self
            .https_tokens
            .iter()
            .filter(|t| t.host == host)
            .cloned()
            .collect();
        self.https_tokens.retain(|t| t.host != host);
        self.https_tokens.push(info.clone());
        self.save()?;
        for old in previous {
            let _ = store.delete(&old.id);
        }
        Ok(info)
    }

    pub fn delete_https_token(&mut self, store: &dyn SecretStore, id: &str) -> AppResult<()> {
        let before = self.https_tokens.len();
        self.https_tokens.retain(|t| t.id != id);
        if self.https_tokens.len() == before {
            return Err(AppError::not_found("no such token"));
        }
        self.save()?;
        store.delete(id)
    }

    fn save(&self) -> AppResult<()> {
        let Some(file) = &self.file else {
            return Ok(());
        };
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(&CredentialsFile {
            ssh_key: self.ssh_key.clone(),
            https_tokens: self.https_tokens.clone(),
        })
        .map_err(|e| AppError::internal(e.to_string()))?;
        crate::notebook::files::write_atomic(file, text.as_bytes())
    }
}

/// Snapshot of the config plus the store, resolving credentials per remote URL.
#[derive(Debug)]
pub struct ConfiguredCredentials {
    ssh_key: Option<SshKeyInfo>,
    tokens: Vec<HttpsTokenInfo>,
    store: Arc<dyn SecretStore>,
}

impl ConfiguredCredentials {
    pub fn new(config: &CredentialsConfig, store: Arc<dyn SecretStore>) -> Self {
        Self {
            ssh_key: config.ssh_key.clone(),
            tokens: config.https_tokens.clone(),
            store,
        }
    }
}

impl CredentialProvider for ConfiguredCredentials {
    fn credentials_for(&self, url: &str) -> AppResult<Credentials> {
        let remote = RemoteUrl::parse(url);
        match remote.transport {
            Transport::Ssh => {
                let Some(key) = &self.ssh_key else {
                    return Err(AppError::Auth {
                        message: format!(
                            "No SSH key yet. Generate one under Credentials and add the public key to {}.",
                            remote.host
                        ),
                    });
                };
                let private_key = self.store.get(&key.id)?.ok_or_else(|| {
                    AppError::secrets(
                        "The SSH private key is missing from the credential store; generate a new key.",
                    )
                })?;
                Ok(Credentials::SshKey {
                    private_key,
                    public_key: key.public_key.clone(),
                })
            }
            Transport::Https | Transport::Http => {
                let host = remote.host.to_ascii_lowercase();
                match self.tokens.iter().find(|t| t.host == host) {
                    Some(info) => {
                        let token = self.store.get(&info.id)?.ok_or_else(|| {
                            AppError::secrets(format!(
                                "The token for {host} is missing from the credential store; save it again."
                            ))
                        })?;
                        Ok(Credentials::Token {
                            username: if info.username.is_empty() {
                                "git".to_owned()
                            } else {
                                info.username.clone()
                            },
                            token,
                        })
                    }
                    // Public repositories clone anonymously; a push will then ask for a token.
                    None => Ok(Credentials::None),
                }
            }
            Transport::Local | Transport::Unknown => Ok(Credentials::None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecretStore;

    #[test]
    fn ssh_key_lifecycle() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cfg/credentials.json");
        let store = MemorySecretStore::default();
        let mut config = CredentialsConfig::load(file.clone()).unwrap();
        assert!(config.ssh_key().is_none());

        let key = config.generate_ssh_key(&store, "git-notes@laptop").unwrap();
        assert!(key.public_key.starts_with("ssh-ed25519 "));
        assert!(key.public_key.ends_with("git-notes@laptop"));
        assert!(key.fingerprint.starts_with("SHA256:"));
        let private = store.get(&key.id).unwrap().unwrap();
        assert!(private.contains("BEGIN OPENSSH PRIVATE KEY"));
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(
            !text.contains("PRIVATE KEY"),
            "config must only hold references"
        );
        assert!(text.contains(&key.id));

        let second = config.generate_ssh_key(&store, "c").unwrap();
        assert_ne!(second.id, key.id);
        assert_eq!(store.get(&key.id).unwrap(), None, "old key removed");

        let reloaded = CredentialsConfig::load(file).unwrap();
        assert_eq!(reloaded.ssh_key().unwrap().id, second.id);

        config.delete_ssh_key(&store).unwrap();
        assert!(config.ssh_key().is_none());
        assert_eq!(store.get(&second.id).unwrap(), None);
    }

    #[test]
    fn tokens_per_host() {
        let store = MemorySecretStore::default();
        let mut config = CredentialsConfig::in_memory();
        let gh = config
            .save_https_token(&store, "https://GitHub.com/", "me", " ghp_x ")
            .unwrap();
        assert_eq!(gh.host, "github.com");
        assert_eq!(store.get(&gh.id).unwrap().as_deref(), Some("ghp_x"));
        let gh2 = config
            .save_https_token(&store, "github.com", "me", "ghp_y")
            .unwrap();
        assert_eq!(config.https_tokens().len(), 1, "same host replaces");
        assert_eq!(store.get(&gh.id).unwrap(), None);
        config
            .save_https_token(&store, "gitea.local", "", "t")
            .unwrap();
        assert_eq!(config.https_tokens().len(), 2);
        assert!(config.save_https_token(&store, "", "me", "t").is_err());
        assert!(config.save_https_token(&store, "host", "me", " ").is_err());
        config.delete_https_token(&store, &gh2.id).unwrap();
        assert!(config.delete_https_token(&store, &gh2.id).is_err());
        assert_eq!(store.get(&gh2.id).unwrap(), None);
    }

    #[test]
    fn provider_resolves_by_transport() {
        let store: Arc<dyn SecretStore> = Arc::new(MemorySecretStore::default());
        let mut config = CredentialsConfig::in_memory();
        let provider = ConfiguredCredentials::new(&config, Arc::clone(&store));
        assert!(matches!(
            provider.credentials_for("git@github.com:me/r.git"),
            Err(AppError::Auth { .. })
        ));
        assert_eq!(
            provider
                .credentials_for("https://github.com/me/r.git")
                .unwrap(),
            Credentials::None
        );
        assert_eq!(
            provider.credentials_for("/srv/r.git").unwrap(),
            Credentials::None
        );

        config.generate_ssh_key(store.as_ref(), "c").unwrap();
        config
            .save_https_token(store.as_ref(), "github.com", "", "tok")
            .unwrap();
        let provider = ConfiguredCredentials::new(&config, Arc::clone(&store));
        assert!(matches!(
            provider
                .credentials_for("ssh://git@github.com/me/r.git")
                .unwrap(),
            Credentials::SshKey { .. }
        ));
        assert_eq!(
            provider
                .credentials_for("https://GitHub.com/me/r.git")
                .unwrap(),
            Credentials::Token {
                username: "git".into(),
                token: "tok".into()
            }
        );
    }
}
