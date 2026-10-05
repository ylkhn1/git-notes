//! The sync algorithm, as specified in the project brief:
//!
//! stage all → commit if dirty → fetch → if diverged, rebase local commits onto upstream;
//! if the rebase hits conflicts, abort and merge instead, keeping both versions of anything
//! the textual 3-way merge cannot resolve → push (retrying after a rejected push).

use std::fmt;
use std::path::Path;
use std::sync::Arc;

use git2::Repository;
use git2::build::CheckoutBuilder;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, AppResult};
use crate::git::auth::CredentialProvider;
use crate::git::commit::{self, Author, Head};
use crate::git::known_hosts::HostKeyStore;
use crate::git::merge::{self, ConflictCopy, RebaseOutcome};
use crate::git::remote::{self, PushOutcome, Upstream};
use crate::git::time::LocalTime;

use super::SyncState;

/// Everything one sync needs besides the repository path.
pub struct SyncContext {
    pub author: Author,
    /// Appears in commit messages and conflict copy names.
    pub device: String,
    pub credentials: Arc<dyn CredentialProvider>,
    pub hosts: Arc<HostKeyStore>,
}

impl fmt::Debug for SyncContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SyncContext")
            .field("author", &self.author)
            .field("device", &self.device)
            .finish_non_exhaustive()
    }
}

/// Outcome of one sync run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub state: SyncState,
    /// Files included in the local commit made at the start of this run.
    pub committed_files: u32,
    pub pushed: bool,
    /// Upstream commits were integrated (fast-forward, rebase or merge).
    pub pulled: bool,
    pub conflicts: Vec<ConflictCopy>,
}

impl SyncReport {
    fn new() -> Self {
        Self::with_state(SyncState::Idle)
    }

    /// A report for a run that did no work (busy, failed to start).
    pub fn with_state(state: SyncState) -> Self {
        Self {
            state,
            committed_files: 0,
            pushed: false,
            pulled: false,
            conflicts: Vec::new(),
        }
    }
}

/// How many times a rejected push (someone pushed in between) is retried after refetching.
const MAX_PUSH_ATTEMPTS: usize = 3;

/// Runs one full sync. Never panics on remote trouble: network failures become
/// [`SyncState::Offline`], everything else [`SyncState::Error`].
pub fn sync(root: &Path, ctx: &SyncContext) -> SyncReport {
    let mut report = SyncReport::new();
    match run(root, ctx, &mut report) {
        Ok(()) => {}
        Err(AppError::Network { message }) => {
            tracing::info!(%message, "sync: remote unreachable; changes stay committed locally");
            report.state = SyncState::Offline;
        }
        Err(error) => {
            tracing::warn!(%error, "sync failed");
            report.state = SyncState::Error(error.to_string());
        }
    }
    report
}

fn run(root: &Path, ctx: &SyncContext, report: &mut SyncReport) -> AppResult<()> {
    let repo = crate::git::open(root)?;
    recover_interrupted(&repo)?;
    attach_head(&repo)?;
    let signature = ctx.author.signature()?;

    if let Some((_, summary)) = commit::commit_all_if_dirty(&repo, &ctx.author, &ctx.device)? {
        report.committed_files = u32::try_from(summary.total()).unwrap_or(u32::MAX);
        tracing::debug!(files = summary.total(), "sync: committed local changes");
    }

    let Some(url) = remote::remote_url(&repo)? else {
        // Local-only notebook: committing is all there is to do.
        report.state = SyncState::Idle;
        return Ok(());
    };
    let credentials = ctx.credentials.credentials_for(&url)?;

    for attempt in 1..=MAX_PUSH_ATTEMPTS {
        let fetched = remote::fetch(&repo, &credentials, &ctx.hosts)?;
        let head = commit::head(&repo)?;
        let branch = head
            .branch_name()
            .ok_or_else(|| AppError::internal("HEAD is still detached"))?
            .to_owned();
        let upstream = remote::resolve_upstream(&repo, &branch, fetched.default_branch.as_deref())?;
        let remote_branch = upstream
            .as_ref()
            .map_or_else(|| branch.clone(), |u| u.remote_branch.clone());

        let need_push = match (head.oid(), upstream) {
            (None, None) => false,
            (None, Some(upstream)) => {
                checkout_unborn(&repo, &branch, &upstream)?;
                report.pulled = true;
                false
            }
            (Some(_), None) => true,
            (Some(local), Some(upstream)) if local == upstream.oid => false,
            (Some(local), Some(upstream)) => {
                let (ahead, behind) = repo.graph_ahead_behind(local, upstream.oid)?;
                if behind == 0 {
                    true
                } else if ahead == 0 {
                    fast_forward(&repo, &branch, &upstream)?;
                    report.pulled = true;
                    false
                } else {
                    integrate(&repo, &upstream, &signature, ctx, report)?;
                    report.pulled = true;
                    true
                }
            }
        };

        if !need_push {
            finish(report);
            return Ok(());
        }
        match remote::push(&repo, &branch, &remote_branch, &credentials, &ctx.hosts)? {
            PushOutcome::Pushed => {
                report.pushed = true;
                finish(report);
                return Ok(());
            }
            PushOutcome::Rejected(message) => {
                tracing::info!(attempt, %message, "sync: push rejected, refetching");
                if attempt == MAX_PUSH_ATTEMPTS {
                    return Err(AppError::Git {
                        message: format!("push rejected {MAX_PUSH_ATTEMPTS} times: {message}"),
                    });
                }
            }
        }
    }
    Ok(())
}

fn finish(report: &mut SyncReport) {
    report.state = if report.conflicts.is_empty() {
        SyncState::UpToDate
    } else {
        SyncState::Conflict(report.conflicts.iter().map(|c| c.copy.clone()).collect())
    };
}

/// Rebase first; if that conflicts, merge and keep both versions.
fn integrate(
    repo: &Repository,
    upstream: &Upstream,
    signature: &git2::Signature<'_>,
    ctx: &SyncContext,
    report: &mut SyncReport,
) -> AppResult<()> {
    match merge::rebase_onto(repo, upstream.oid, signature)? {
        RebaseOutcome::Completed => {
            tracing::debug!("sync: rebased local commits onto upstream");
        }
        RebaseOutcome::Conflicted => {
            let stamp = LocalTime::now().stamp();
            let result =
                merge::merge_keep_both(repo, upstream.oid, signature, &ctx.device, &stamp)?;
            tracing::info!(
                conflicts = result.conflicts.len(),
                "sync: merged with conflict copies"
            );
            report.conflicts.extend(result.conflicts);
        }
    }
    Ok(())
}

/// Moves `branch` to the upstream tip and updates the working tree (local has no own commits).
fn fast_forward(repo: &Repository, branch: &str, upstream: &Upstream) -> AppResult<()> {
    let tree = repo.find_commit(upstream.oid)?.tree()?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(tree.as_object(), Some(&mut checkout))?;
    repo.reference(
        &format!("refs/heads/{branch}"),
        upstream.oid,
        true,
        "sync: fast-forward",
    )?;
    Ok(())
}

/// First sync of an empty local repo against a remote that already has commits.
fn checkout_unborn(repo: &Repository, branch: &str, upstream: &Upstream) -> AppResult<()> {
    let refname = format!("refs/heads/{branch}");
    repo.reference(&refname, upstream.oid, true, "sync: initial checkout")?;
    repo.set_head(&refname)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_head(Some(&mut checkout))?;
    Ok(())
}

/// Cleans up after a crash in the middle of an earlier merge or rebase.
fn recover_interrupted(repo: &Repository) -> AppResult<()> {
    use git2::RepositoryState as S;
    match repo.state() {
        S::Clean => {}
        S::Rebase | S::RebaseInteractive | S::RebaseMerge => {
            tracing::warn!("sync: aborting an interrupted rebase");
            match repo.open_rebase(None) {
                Ok(mut rebase) => rebase.abort()?,
                Err(_) => repo.cleanup_state()?,
            }
        }
        other => {
            tracing::warn!(?other, "sync: clearing an interrupted operation");
            repo.cleanup_state()?;
        }
    }
    Ok(())
}

/// A detached HEAD would make every commit unreachable from any branch; attach it first.
fn attach_head(repo: &Repository) -> AppResult<()> {
    let Head::Detached(oid) = commit::head(repo)? else {
        return Ok(());
    };
    let default = format!("refs/heads/{}", crate::git::DEFAULT_BRANCH);
    let tip = repo.find_reference(&default).ok().and_then(|r| r.target());
    let main_is_behind = match tip {
        None => true,
        Some(tip) => tip == oid || repo.graph_descendant_of(oid, tip)?,
    };
    let refname = if main_is_behind {
        default
    } else {
        format!(
            "refs/heads/recovered-{}",
            LocalTime::now().stamp().replace(' ', "-")
        )
    };
    tracing::warn!(%refname, "sync: HEAD was detached; attaching");
    // Pointing a branch at the commit HEAD already has leaves index and files untouched.
    repo.reference(&refname, oid, true, "sync: attach detached HEAD")?;
    repo.set_head(&refname)?;
    Ok(())
}
