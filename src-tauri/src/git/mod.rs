//! Git operations as pure functions over a repository path.
//!
//! Nothing in this module depends on Tauri, so it is fully testable with `cargo test`.
//! Clone / commit / fetch / rebase / merge / push / history arrive in Phase 2.

/// Version of the linked libgit2 plus the transport features it was built with.
///
/// Example: `1.9.1 (https, ssh)`. Both features must be present on every platform,
/// which is why this is surfaced in the diagnostics screen.
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
    }

    #[test]
    fn version_string_is_formatted() {
        let text = libgit2_version();
        assert!(text.contains("https"));
        assert!(text.contains("ssh"));
    }
}
