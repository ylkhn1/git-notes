//! Remote operations: clone, fetch, push and upstream resolution.

use std::cell::RefCell;
use std::path::Path;

use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    AutotagOption, BranchType, ErrorCode, FetchOptions, FetchPrune, Oid, PushOptions, Repository,
};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, AppResult};

use super::auth::{self, AuthTrace, Credentials};
use super::known_hosts::HostKeyStore;
use super::url::{RemoteUrl, Transport};

pub const ORIGIN: &str = "origin";

pub fn remote_url(repo: &Repository) -> AppResult<Option<String>> {
    match repo.find_remote(ORIGIN) {
        Ok(remote) => Ok(remote.url().ok().map(str::to_owned)),
        Err(e) if e.code() == ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Creates or updates `origin`.
pub fn set_remote_url(repo: &Repository, url: &str) -> AppResult<()> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::invalid_input("remote URL must not be empty"));
    }
    if RemoteUrl::parse(url).transport == Transport::Unknown {
        return Err(AppError::invalid_input(format!(
            "'{url}' is not a git URL (expected ssh://…, https://…, git@host:path or a local path)"
        )));
    }
    match repo.find_remote(ORIGIN) {
        Ok(_) => repo.remote_set_url(ORIGIN, url)?,
        Err(e) if e.code() == ErrorCode::NotFound => {
            repo.remote(ORIGIN, url)?;
        }
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

pub fn remove_remote(repo: &Repository) -> AppResult<()> {
    match repo.remote_delete(ORIGIN) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == ErrorCode::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchOutcome {
    /// Branch the remote's HEAD points to (e.g. `main`), when the server advertises it.
    pub default_branch: Option<String>,
}

/// Fetches all branches of `origin`, pruning deleted ones.
pub fn fetch(
    repo: &Repository,
    creds: &Credentials,
    hosts: &HostKeyStore,
) -> AppResult<FetchOutcome> {
    let mut remote = repo.find_remote(ORIGIN)?;
    let url = remote.url().unwrap_or_default().to_owned();
    let trace = AuthTrace::default();
    let mut options = FetchOptions::new();
    options
        .remote_callbacks(auth::callbacks(creds, hosts, &trace))
        .prune(FetchPrune::On)
        .download_tags(AutotagOption::None);
    let refspecs: [&str; 0] = [];
    remote
        .fetch(&refspecs, Some(&mut options), None)
        .map_err(|e| auth::into_app_error(e, &url, &trace))?;
    let default_branch = remote.default_branch().ok().and_then(|buf| {
        buf.as_str()
            .ok()
            .map(|s| s.trim_start_matches("refs/heads/").to_owned())
    });
    Ok(FetchOutcome { default_branch })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushOutcome {
    Pushed,
    /// The server refused the update (usually non-fast-forward); message from the server.
    Rejected(String),
}

/// Pushes `local_branch` to `origin/remote_branch` and records it as the upstream.
pub fn push(
    repo: &Repository,
    local_branch: &str,
    remote_branch: &str,
    creds: &Credentials,
    hosts: &HostKeyStore,
) -> AppResult<PushOutcome> {
    let mut remote = repo.find_remote(ORIGIN)?;
    let url = remote.url().unwrap_or_default().to_owned();
    let trace = AuthTrace::default();
    let rejected: RefCell<Option<String>> = RefCell::new(None);

    let mut callbacks = auth::callbacks(creds, hosts, &trace);
    callbacks.push_update_reference(|refname, status| {
        if let Some(message) = status {
            *rejected.borrow_mut() = Some(format!("{refname}: {message}"));
        }
        Ok(())
    });
    let mut options = PushOptions::new();
    options.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{local_branch}:refs/heads/{remote_branch}");
    remote
        .push(&[refspec.as_str()], Some(&mut options))
        .map_err(|e| auth::into_app_error(e, &url, &trace))?;
    drop(options);

    if let Some(message) = rejected.into_inner() {
        return Ok(PushOutcome::Rejected(message));
    }
    if let Ok(mut branch) = repo.find_branch(local_branch, BranchType::Local) {
        // Best effort: lets plain git tools agree on the tracking branch.
        let _ = branch.set_upstream(Some(&format!("{ORIGIN}/{remote_branch}")));
    }
    Ok(PushOutcome::Pushed)
}

/// The remote branch a local branch syncs with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Upstream {
    pub remote_branch: String,
    pub oid: Oid,
}

/// Picks the upstream for `local_branch`: the configured tracking branch, else the remote
/// branch with the same name, else the remote's default branch.
pub fn resolve_upstream(
    repo: &Repository,
    local_branch: &str,
    default_branch: Option<&str>,
) -> AppResult<Option<Upstream>> {
    if let Ok(branch) = repo.find_branch(local_branch, BranchType::Local)
        && let Ok(tracking) = branch.upstream()
        && let Ok(Some(name)) = tracking.name()
        && let Some(remote_branch) = name.strip_prefix(&format!("{ORIGIN}/"))
        && let Some(oid) = tracking.get().target()
    {
        return Ok(Some(Upstream {
            remote_branch: remote_branch.to_owned(),
            oid,
        }));
    }

    let mut candidates = vec![local_branch.to_owned()];
    if let Some(name) = default_branch {
        candidates.push(name.to_owned());
    }
    if let Ok(head) = repo.find_reference(&format!("refs/remotes/{ORIGIN}/HEAD"))
        && let Ok(Some(target)) = head.symbolic_target()
    {
        candidates.push(
            target
                .trim_start_matches(&format!("refs/remotes/{ORIGIN}/"))
                .to_owned(),
        );
    }
    for name in candidates {
        if let Ok(reference) = repo.find_reference(&format!("refs/remotes/{ORIGIN}/{name}"))
            && let Some(oid) = reference.target()
        {
            return Ok(Some(Upstream {
                remote_branch: name,
                oid,
            }));
        }
    }
    Ok(None)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum CloneStage {
    Connecting,
    Receiving,
    Checkout,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub stage: CloneStage,
    pub received_objects: u32,
    pub total_objects: u32,
    pub indexed_objects: u32,
    #[specta(type = specta_typescript::Number)]
    pub received_bytes: u64,
    pub checkout_done: u32,
    pub checkout_total: u32,
}

fn clamp_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Clones `url` into `dest` (which must not exist or be empty), reporting progress.
pub fn clone(
    url: &str,
    dest: &Path,
    creds: &Credentials,
    hosts: &HostKeyStore,
    on_progress: &mut dyn FnMut(&CloneProgress),
) -> AppResult<Repository> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::invalid_input("repository URL must not be empty"));
    }
    if dest.exists() && std::fs::read_dir(dest)?.next().is_some() {
        return Err(AppError::already_exists(format!(
            "{} already exists and is not empty",
            dest.display()
        )));
    }
    let created_by_us = !dest.exists();

    let progress = RefCell::new(CloneProgress {
        stage: CloneStage::Connecting,
        received_objects: 0,
        total_objects: 0,
        indexed_objects: 0,
        received_bytes: 0,
        checkout_done: 0,
        checkout_total: 0,
    });
    let report = RefCell::new(on_progress);
    let trace = AuthTrace::default();

    let mut callbacks = auth::callbacks(creds, hosts, &trace);
    callbacks.transfer_progress(|stats| {
        let mut p = progress.borrow_mut();
        p.stage = CloneStage::Receiving;
        p.received_objects = clamp_u32(stats.received_objects());
        p.total_objects = clamp_u32(stats.total_objects());
        p.indexed_objects = clamp_u32(stats.indexed_objects());
        p.received_bytes = stats.received_bytes() as u64;
        (report.borrow_mut())(&p);
        true
    });
    let mut fetch = FetchOptions::new();
    fetch
        .remote_callbacks(callbacks)
        .download_tags(AutotagOption::None);

    let mut checkout = CheckoutBuilder::new();
    checkout.progress(|_path, done, total| {
        let mut p = progress.borrow_mut();
        p.stage = CloneStage::Checkout;
        p.checkout_done = clamp_u32(done);
        p.checkout_total = clamp_u32(total);
        (report.borrow_mut())(&p);
    });

    let result = RepoBuilder::new()
        .fetch_options(fetch)
        .with_checkout(checkout)
        .clone(url, dest);

    match result {
        Ok(repo) => {
            // An empty remote leaves HEAD unborn on whatever name libgit2 picked; use ours.
            if matches!(
                super::commit::head(&repo)?,
                super::commit::Head::Unborn { .. }
            ) {
                repo.set_head(&format!("refs/heads/{}", super::DEFAULT_BRANCH))?;
            }
            super::write_excludes(&repo)?;
            Ok(repo)
        }
        Err(error) => {
            if created_by_us {
                let _ = std::fs::remove_dir_all(dest);
            }
            Err(auth::into_app_error(error, url, &trace))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_read_remote_url() {
        let dir = tempfile::tempdir().unwrap();
        let repo = crate::git::init(dir.path()).unwrap();
        assert_eq!(remote_url(&repo).unwrap(), None);
        set_remote_url(&repo, " git@github.com:me/notes.git ").unwrap();
        assert_eq!(
            remote_url(&repo).unwrap().as_deref(),
            Some("git@github.com:me/notes.git")
        );
        set_remote_url(&repo, "https://example.org/me/notes.git").unwrap();
        assert_eq!(
            remote_url(&repo).unwrap().as_deref(),
            Some("https://example.org/me/notes.git")
        );
        assert!(set_remote_url(&repo, "").is_err());
        assert!(set_remote_url(&repo, "not a url").is_err());
        remove_remote(&repo).unwrap();
        assert_eq!(remote_url(&repo).unwrap(), None);
    }

    #[test]
    fn clone_refuses_non_empty_destination() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("x"), "x").unwrap();
        let hosts = HostKeyStore::in_memory();
        let error = clone(
            "/nonexistent/repo.git",
            dir.path(),
            &Credentials::None,
            &hosts,
            &mut |_| {},
        )
        .err()
        .unwrap();
        assert!(matches!(error, AppError::AlreadyExists { .. }));
    }

    #[test]
    fn failed_clone_cleans_up_and_is_offline() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("notes");
        let hosts = HostKeyStore::in_memory();
        let error = clone(
            dir.path().join("missing.git").to_str().unwrap(),
            &dest,
            &Credentials::None,
            &hosts,
            &mut |_| {},
        )
        .err()
        .unwrap();
        assert!(matches!(error, AppError::Network { .. }), "{error:?}");
        assert!(!dest.exists());
    }
}
