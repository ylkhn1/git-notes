//! The single error type crossing the Rust ↔ frontend boundary.

use serde::Serialize;
use specta::Type;

/// Serializable application error. Every command returns `Result<T, AppError>`.
///
/// Variants are tagged by `kind` so the frontend can branch on them without string matching.
#[derive(Debug, Clone, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    #[error("I/O error: {message}")]
    Io { message: String },

    #[error("git error: {message}")]
    Git { message: String },

    #[error("authentication failed: {message}")]
    Auth { message: String },

    #[error("invalid input: {message}")]
    InvalidInput { message: String },

    #[error("not found: {message}")]
    NotFound { message: String },

    #[error("already exists: {message}")]
    AlreadyExists { message: String },

    #[error("{message}")]
    Internal { message: String },
}

impl AppError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound {
            message: message.into(),
        }
    }

    pub fn already_exists(message: impl Into<String>) -> Self {
        Self::AlreadyExists {
            message: message.into(),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

impl From<git2::Error> for AppError {
    fn from(error: git2::Error) -> Self {
        // libgit2 reports auth failures via a dedicated class; surface them separately so the
        // UI can show an actionable "check your token / SSH key" message.
        let auth_class = matches!(
            error.class(),
            git2::ErrorClass::Ssh | git2::ErrorClass::Http
        );
        if auth_class && error.code() == git2::ErrorCode::Auth {
            Self::Auth {
                message: error.message().to_owned(),
            }
        } else {
            Self::Git {
                message: error.message().to_owned(),
            }
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_kind_tag() {
        let error = AppError::invalid_input("bad path");
        let json = serde_json::to_value(&error).expect("serialize");
        assert_eq!(json["kind"], "invalidInput");
        assert_eq!(json["message"], "bad path");
    }

    #[test]
    fn maps_git_auth_errors() {
        let error = git2::Error::new(git2::ErrorCode::Auth, git2::ErrorClass::Ssh, "denied");
        assert!(matches!(AppError::from(error), AppError::Auth { .. }));
    }
}
