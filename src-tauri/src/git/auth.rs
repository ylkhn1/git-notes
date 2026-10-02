//! Credentials for remotes, libgit2 callbacks and error classification.
//!
//! Secrets only ever exist here as in-memory values handed to libgit2; `Debug` output is
//! redacted so they cannot leak into logs.

use std::cell::{Cell, RefCell};
use std::fmt;

use git2::{CertificateCheckStatus, Cred, CredentialType, ErrorClass, ErrorCode, RemoteCallbacks};

use crate::error::AppError;

use super::known_hosts::{HostKeyCheck, HostKeyStore, fingerprint_sha256};
use super::url::{RemoteUrl, Transport};

/// What to present to a remote.
#[derive(Clone, PartialEq, Eq)]
pub enum Credentials {
    /// Anonymous access (public HTTPS clone, local paths).
    None,
    /// In-app ed25519 identity in OpenSSH format.
    SshKey {
        private_key: String,
        public_key: String,
    },
    /// HTTPS basic auth with a personal access token as the password.
    Token { username: String, token: String },
}

impl fmt::Debug for Credentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::None => f.write_str("Credentials::None"),
            Self::SshKey { .. } => f.write_str("Credentials::SshKey(<redacted>)"),
            Self::Token { username, .. } => write!(f, "Credentials::Token({username}, <redacted>)"),
        }
    }
}

/// Resolves which credentials to use for a remote URL.
pub trait CredentialProvider: Send + Sync {
    fn credentials_for(&self, url: &str) -> Result<Credentials, AppError>;
}

/// Always anonymous (local-path remotes, tests).
#[derive(Debug, Default)]
pub struct NoCredentials;

impl CredentialProvider for NoCredentials {
    fn credentials_for(&self, _url: &str) -> Result<Credentials, AppError> {
        Ok(Credentials::None)
    }
}

/// The same credentials for every URL.
#[derive(Debug)]
pub struct StaticCredentials(pub Credentials);

impl CredentialProvider for StaticCredentials {
    fn credentials_for(&self, _url: &str) -> Result<Credentials, AppError> {
        Ok(self.0.clone())
    }
}

/// What the callbacks observed during one network operation; turns libgit2's generic errors
/// into actionable ones afterwards.
#[derive(Debug, Default)]
pub struct AuthTrace {
    attempts: Cell<u32>,
    /// The remote asked for credentials we do not have.
    missing: Cell<bool>,
    host_key_mismatch: RefCell<Option<String>>,
}

const MAX_AUTH_ATTEMPTS: u32 = 4;

/// libgit2 callbacks wiring `creds` and the TOFU host-key check.
pub fn callbacks<'a>(
    creds: &'a Credentials,
    hosts: &'a HostKeyStore,
    trace: &'a AuthTrace,
) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();

    callbacks.credentials(move |_url, username_from_url, allowed| {
        let attempt = trace.attempts.get();
        trace.attempts.set(attempt + 1);
        if attempt >= MAX_AUTH_ATTEMPTS {
            return Err(git2::Error::new(
                ErrorCode::Auth,
                ErrorClass::Callback,
                "the remote rejected the configured credentials",
            ));
        }
        match creds {
            Credentials::SshKey {
                private_key,
                public_key,
            } => {
                let user = username_from_url.unwrap_or("git");
                if allowed.contains(CredentialType::USERNAME) {
                    return Cred::username(user);
                }
                if allowed.contains(CredentialType::SSH_MEMORY)
                    || allowed.contains(CredentialType::SSH_KEY)
                {
                    return Cred::ssh_key_from_memory(user, Some(public_key), private_key, None);
                }
            }
            Credentials::Token { username, token } => {
                if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
                    return Cred::userpass_plaintext(username, token);
                }
            }
            Credentials::None => {}
        }
        trace.missing.set(true);
        Err(git2::Error::new(
            ErrorCode::Auth,
            ErrorClass::Callback,
            "no credentials configured for this remote",
        ))
    });

    callbacks.certificate_check(move |cert, host| {
        // X.509 (HTTPS) is validated by the TLS stack; only SSH host keys are ours to judge.
        let Some(hostkey) = cert.as_hostkey() else {
            return Ok(CertificateCheckStatus::CertificatePassthrough);
        };
        let Some(hash) = hostkey.hash_sha256() else {
            return Ok(CertificateCheckStatus::CertificatePassthrough);
        };
        let fingerprint = fingerprint_sha256(hash);
        let key_type = hostkey
            .hostkey_type()
            .map(|t| t.short_name())
            .unwrap_or("unknown");
        match hosts.check_and_remember(host, key_type, &fingerprint) {
            HostKeyCheck::Known | HostKeyCheck::FirstUse => Ok(CertificateCheckStatus::CertificateOk),
            HostKeyCheck::Mismatch { stored } => {
                *trace.host_key_mismatch.borrow_mut() = Some(format!(
                    "The SSH host key for {host} changed (stored {stored}, got {fingerprint}). \
                     If the server really changed its key, forget the host under Credentials and retry."
                ));
                Err(git2::Error::new(
                    ErrorCode::Certificate,
                    ErrorClass::Ssh,
                    "SSH host key mismatch",
                ))
            }
        }
    });

    callbacks
}

/// Coarse failure kinds the sync engine reacts to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// Remote unreachable: DNS, connection, timeout, missing local path.
    Offline,
    /// Credentials rejected, missing, or host key mismatch.
    Auth,
    Other,
}

pub fn classify(error: &git2::Error, url: &str, trace: &AuthTrace) -> Failure {
    if trace.host_key_mismatch.borrow().is_some() || trace.missing.get() {
        return Failure::Auth;
    }
    let message = error.message().to_ascii_lowercase();
    let auth_words = [
        "authentication",
        "credential",
        "permission denied",
        "403",
        "401",
        "unauthorized",
        "publickey",
    ];
    if error.code() == ErrorCode::Auth
        || (matches!(error.class(), ErrorClass::Ssh | ErrorClass::Http)
            && auth_words.iter().any(|w| message.contains(w)))
    {
        return Failure::Auth;
    }
    let network_words = [
        "resolve",
        "connect",
        "timed out",
        "timeout",
        "unreachable",
        "network",
        "reset by peer",
        "broken pipe",
        "ssl",
        "tls",
    ];
    let network_class = matches!(
        error.class(),
        ErrorClass::Net | ErrorClass::Os | ErrorClass::Http | ErrorClass::Ssh
    );
    if error.class() == ErrorClass::Net
        || (network_class && network_words.iter().any(|w| message.contains(w)))
    {
        return Failure::Offline;
    }
    // A local-path remote that cannot be opened is the local equivalent of "offline"
    // (unmounted drive, missing share).
    if RemoteUrl::parse(url).is_local()
        && (error.code() == ErrorCode::NotFound
            || matches!(error.class(), ErrorClass::Repository | ErrorClass::Os))
    {
        return Failure::Offline;
    }
    Failure::Other
}

/// Converts a libgit2 error from a network operation into a user-facing `AppError`.
pub fn into_app_error(error: git2::Error, url: &str, trace: &AuthTrace) -> AppError {
    let remote = RemoteUrl::parse(url);
    let host = if remote.host.is_empty() {
        "the remote".to_owned()
    } else {
        remote.host.clone()
    };
    match classify(&error, url, trace) {
        Failure::Offline => AppError::Network {
            message: format!("{host} is unreachable: {}", error.message()),
        },
        Failure::Auth => {
            let message = if let Some(mismatch) = trace.host_key_mismatch.borrow().clone() {
                mismatch
            } else if trace.missing.get() {
                match remote.transport {
                    Transport::Ssh => format!(
                        "{host} needs an SSH key. Generate one under Credentials and add the public key to your git host."
                    ),
                    Transport::Https | Transport::Http => format!(
                        "{host} needs an access token. Save one for this host under Credentials."
                    ),
                    _ => format!("{host} asked for credentials but none are configured."),
                }
            } else {
                match remote.transport {
                    Transport::Ssh => format!(
                        "{host} rejected the SSH key ({}). Check that the public key is added to your account or as a deploy key with write access.",
                        error.message()
                    ),
                    _ => format!(
                        "{host} rejected the access token ({}). Check that it is valid and has repository write access.",
                        error.message()
                    ),
                }
            };
            AppError::Auth { message }
        }
        Failure::Other => error.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err(code: ErrorCode, class: ErrorClass, msg: &str) -> git2::Error {
        git2::Error::new(code, class, msg)
    }

    #[test]
    fn debug_output_is_redacted() {
        let creds = Credentials::Token {
            username: "me".into(),
            token: "ghp_secret".into(),
        };
        let text = format!("{creds:?}");
        assert!(!text.contains("ghp_secret"));
        let key = Credentials::SshKey {
            private_key: "PRIVATE".into(),
            public_key: "ssh-ed25519 AAA".into(),
        };
        assert!(!format!("{key:?}").contains("PRIVATE"));
    }

    #[test]
    fn classifies_network_and_auth_errors() {
        let trace = AuthTrace::default();
        let url = "https://github.com/me/repo.git";
        assert_eq!(
            classify(
                &err(
                    ErrorCode::GenericError,
                    ErrorClass::Net,
                    "failed to resolve address"
                ),
                url,
                &trace
            ),
            Failure::Offline
        );
        assert_eq!(
            classify(
                &err(
                    ErrorCode::GenericError,
                    ErrorClass::Os,
                    "connection timed out"
                ),
                url,
                &trace
            ),
            Failure::Offline
        );
        assert_eq!(
            classify(
                &err(
                    ErrorCode::Auth,
                    ErrorClass::Http,
                    "too many redirects or authentication replays"
                ),
                url,
                &trace
            ),
            Failure::Auth
        );
        assert_eq!(
            classify(
                &err(
                    ErrorCode::GenericError,
                    ErrorClass::Http,
                    "unexpected http status code: 403"
                ),
                url,
                &trace
            ),
            Failure::Auth
        );
        assert_eq!(
            classify(
                &err(ErrorCode::GenericError, ErrorClass::Odb, "object not found"),
                url,
                &trace
            ),
            Failure::Other
        );
    }

    #[test]
    fn missing_local_remote_counts_as_offline() {
        let trace = AuthTrace::default();
        let error = err(
            ErrorCode::NotFound,
            ErrorClass::Repository,
            "could not find repository",
        );
        assert_eq!(
            classify(&error, "/mnt/usb/notes.git", &trace),
            Failure::Offline
        );
        assert!(matches!(
            into_app_error(error, "/mnt/usb/notes.git", &trace),
            AppError::Network { .. }
        ));
    }

    #[test]
    fn missing_credentials_message_is_actionable() {
        let trace = AuthTrace::default();
        trace.missing.set(true);
        let error = err(ErrorCode::Auth, ErrorClass::Callback, "no credentials");
        let AppError::Auth { message } =
            into_app_error(error, "git@github.com:me/repo.git", &trace)
        else {
            panic!("expected auth error");
        };
        assert!(message.contains("github.com"));
        assert!(message.contains("SSH key"));
    }
}
