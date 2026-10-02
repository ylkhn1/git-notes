//! Manual checks against real services. Ignored by default; run with
//! `cargo test --test network -- --ignored` on a machine with network access (and, for the
//! keyring test, a running Secret Service / Credential Manager session).

#![allow(clippy::unwrap_used)]

use git_notes_lib::git::{self, Credentials, HostKeyStore};
use git_notes_lib::secrets::{SecretStore, keyring_store};

/// Exercises the vendored OpenSSL + CA bundle path on Linux/Android builds.
#[test]
#[ignore = "needs network access"]
fn https_clone_of_public_repo_verifies_tls() {
    let dir = tempfile::tempdir().unwrap();
    git::configure(dir.path());
    let dest = dir.path().join("hello");
    let mut events = 0;
    let repo = git::remote::clone(
        "https://github.com/octocat/Hello-World.git",
        &dest,
        &Credentials::None,
        &HostKeyStore::in_memory(),
        &mut |_| events += 1,
    )
    .unwrap();
    assert!(repo.head().unwrap().peel_to_commit().is_ok());
    assert!(dest.join("README").exists());
    assert!(events > 0, "progress callbacks fired");
}

/// Round-trips a secret through the real OS credential store.
#[test]
#[ignore = "needs a desktop session with a credential store"]
fn os_keyring_roundtrip() {
    let store = keyring_store::open().unwrap();
    let id = format!("test-{}", std::process::id());
    assert_eq!(store.get(&id).unwrap(), None);
    store.set(&id, "s3cret").unwrap();
    assert_eq!(store.get(&id).unwrap().as_deref(), Some("s3cret"));
    store.delete(&id).unwrap();
    assert_eq!(store.get(&id).unwrap(), None);
    store.delete(&id).unwrap();
}
