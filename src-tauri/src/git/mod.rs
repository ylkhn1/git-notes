//! Git operations as pure functions over a repository path.
//!
//! Nothing in this module depends on Tauri, so it is fully testable with `cargo test`.
//! The user's global/system git config is deliberately ignored (see [`configure`]): the app
//! supplies author, remotes and credentials itself and must not be surprised by `insteadOf`
//! rewrites or credential helpers.

#[cfg(target_os = "android")]
mod android_tls;
pub mod auth;
pub mod commit;
pub mod history;
pub mod known_hosts;
pub mod merge;
pub mod remote;
pub mod status;
pub mod time;
pub mod url;

pub use auth::{CredentialProvider, Credentials, NoCredentials, StaticCredentials};
pub use commit::{Author, ChangeSummary, Head};
pub use history::{
    ChangeKind, ChangedFile, CommitInfo, DeletedFile, DiffHunk, DiffLine, FileDiff, FileVersion,
    LineKind, NoteCommit,
};
pub use known_hosts::{HostKeyStore, KnownHost};
pub use merge::{ConflictCopy, ConflictName};
pub use remote::{CloneProgress, CloneStage};
pub use status::RepoStatus;
pub use url::{RemoteUrl, Transport};

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use git2::{ConfigLevel, Repository, RepositoryInitOptions, RepositoryOpenFlags};

use crate::error::{AppError, AppResult};

/// Branch name for new notebooks and the fallback when a remote advertises none.
pub const DEFAULT_BRANCH: &str = "main";

/// Patterns the app never commits: the temp files of its own atomic writes.
const EXCLUDES: &str = "# managed by git-notes\n.*.tmp\n";

static CONFIGURED: OnceLock<PathBuf> = OnceLock::new();

/// One-time libgit2 process configuration. Idempotent; the first call wins.
///
/// * Points every config search path (system, global, XDG, ProgramData) at an empty folder
///   under `app_dir`, so `~/.gitconfig` can never influence the app.
/// * Gives the vendored OpenSSL its trusted roots: a CA bundle file on desktop Linux, the
///   system certificates loaded from memory on Android (see `android_tls`).
pub fn configure(app_dir: &Path) {
    CONFIGURED.get_or_init(|| {
        let empty = app_dir.join("git-isolated-config");
        if let Err(error) = std::fs::create_dir_all(&empty) {
            tracing::warn!(%error, "could not create the isolated git config dir");
        }
        for level in [
            ConfigLevel::System,
            ConfigLevel::Global,
            ConfigLevel::XDG,
            ConfigLevel::ProgramData,
        ] {
            // SAFETY: libgit2 global options are process-wide and not thread-safe to change
            // concurrently; this runs exactly once, before any repository is opened.
            #[allow(unsafe_code)]
            if let Err(error) = unsafe { git2::opts::set_search_path(level, &empty) } {
                tracing::warn!(%error, ?level, "could not isolate git config level");
            }
        }
        #[cfg(target_os = "android")]
        {
            let added = android_tls::install_system_roots();
            if added == 0 {
                tracing::warn!("no system CA certificates found; HTTPS remotes will fail");
            } else {
                tracing::info!(added, "loaded system CA certificates into libgit2");
            }
        }
        #[cfg(not(target_os = "android"))]
        if let Some(bundle) = ca_bundle() {
            // SAFETY: same as above — single-threaded, once.
            #[allow(unsafe_code)]
            match unsafe { git2::opts::set_ssl_cert_file(&bundle) } {
                Ok(()) => tracing::info!(path = %bundle.display(), "using CA bundle"),
                // Windows (WinHTTP) and macOS (SecureTransport) do not take a file; that is fine.
                Err(error) => tracing::warn!(%error, "TLS backend rejected the CA bundle"),
            }
        }
        app_dir.to_path_buf()
    });
}

/// Makes sure [`configure`] ran, defaulting to a scratch dir (tests, CLI use).
fn ensure_configured() {
    if CONFIGURED.get().is_none() {
        configure(&std::env::temp_dir().join("git-notes-libgit2"));
    }
}

/// Finds a PEM bundle of trusted CA certificates for the vendored OpenSSL on desktop Linux.
#[cfg(not(target_os = "android"))]
fn ca_bundle() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("SSL_CERT_FILE").map(PathBuf::from)
        && path.is_file()
    {
        return Some(path);
    }
    [
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/ca-bundle.pem",
        "/etc/pki/tls/cacert.pem",
        "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
        "/etc/ssl/cert.pem",
        "/usr/local/share/certs/ca-root-nss.crt",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|p| p.is_file())
}

/// Opens the repository rooted exactly at `path` (no walking up to a parent repo).
pub fn open(path: &Path) -> AppResult<Repository> {
    ensure_configured();
    Repository::open_ext(
        path,
        RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&OsStr>(),
    )
    .map_err(|error| {
        if error.code() == git2::ErrorCode::NotFound {
            AppError::not_found(format!("{} is not a git repository", path.display()))
        } else {
            error.into()
        }
    })
}

pub fn is_repo(path: &Path) -> bool {
    open(path).is_ok()
}

/// Initialises a repository on branch `main` in an existing folder.
pub fn init(path: &Path) -> AppResult<Repository> {
    ensure_configured();
    if is_repo(path) {
        return Err(AppError::already_exists(format!(
            "{} is already a git repository",
            path.display()
        )));
    }
    let mut options = RepositoryInitOptions::new();
    options.initial_head(DEFAULT_BRANCH).no_reinit(true);
    let repo = Repository::init_opts(path, &options)?;
    write_excludes(&repo)?;
    Ok(repo)
}

/// Writes `.git/info/exclude` so the app's own temp files never get committed.
pub fn write_excludes(repo: &Repository) -> AppResult<()> {
    let info = repo.path().join("info");
    std::fs::create_dir_all(&info)?;
    let file = info.join("exclude");
    let existing = std::fs::read_to_string(&file).unwrap_or_default();
    if !existing.contains(".*.tmp") {
        let mut text = existing;
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(EXCLUDES);
        std::fs::write(file, text)?;
    }
    Ok(())
}

/// Version of the linked libgit2 plus the transport features it was built with.
///
/// Example: `1.9.1 (https, ssh)`. Both features must be present on every platform.
pub fn libgit2_version() -> String {
    let version = git2::Version::get();
    let mut features = Vec::new();
    if version.https() {
        features.push("https");
    }
    if version.ssh() {
        features.push("ssh");
    }
    let (major, minor, rev) = version.libgit2_version();
    format!("{major}.{minor}.{rev} ({})", features.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn libgit2_has_https_and_ssh() {
        let version = git2::Version::get();
        assert!(version.https(), "libgit2 must be built with HTTPS support");
        assert!(version.ssh(), "libgit2 must be built with SSH support");
        assert!(libgit2_version().contains("ssh"));
    }

    #[test]
    fn init_and_open_do_not_search_upwards() {
        let dir = tempfile::tempdir().unwrap();
        let repo = init(dir.path()).unwrap();
        assert!(repo.head().is_err(), "fresh repo has an unborn HEAD");
        assert_eq!(
            repo.find_reference("HEAD")
                .unwrap()
                .symbolic_target()
                .unwrap(),
            Some("refs/heads/main")
        );
        assert!(
            std::fs::read_to_string(dir.path().join(".git/info/exclude"))
                .unwrap()
                .contains(".*.tmp")
        );
        assert!(matches!(
            init(dir.path()),
            Err(AppError::AlreadyExists { .. })
        ));

        let nested = dir.path().join("sub");
        std::fs::create_dir(&nested).unwrap();
        assert!(
            !is_repo(&nested),
            "a folder inside a repo is not itself a repo"
        );
        assert!(matches!(open(&nested), Err(AppError::NotFound { .. })));
    }
}
