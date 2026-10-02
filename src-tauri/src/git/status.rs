//! Repository status as shown in the UI.

use std::path::Path;

use git2::{Repository, RepositoryState};
use serde::Serialize;
use specta::Type;

use crate::error::{AppError, AppResult};

use super::commit::{self, Head};
use super::history::{self, CommitInfo};
use super::remote;

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub detached: bool,
    pub remote_url: Option<String>,
    /// Changed, added or deleted files not yet committed.
    pub dirty_files: u32,
    /// Local commits not on the upstream.
    pub ahead: u32,
    /// Upstream commits not yet integrated.
    pub behind: u32,
    pub last_commit: Option<CommitInfo>,
    /// `merge` or `rebase` when an earlier operation was interrupted; cleaned up on next sync.
    pub in_progress: Option<String>,
}

impl RepoStatus {
    pub fn not_a_repo() -> Self {
        Self {
            is_repo: false,
            branch: None,
            detached: false,
            remote_url: None,
            dirty_files: 0,
            ahead: 0,
            behind: 0,
            last_commit: None,
            in_progress: None,
        }
    }
}

pub fn status(root: &Path) -> AppResult<RepoStatus> {
    let repo = match super::open(root) {
        Ok(repo) => repo,
        Err(AppError::NotFound { .. }) => return Ok(RepoStatus::not_a_repo()),
        Err(e) => return Err(e),
    };
    status_of(&repo)
}

pub fn status_of(repo: &Repository) -> AppResult<RepoStatus> {
    let head = commit::head(repo)?;
    let changes = commit::changes(repo)?;
    let remote_url = remote::remote_url(repo)?;

    let (ahead, behind) = match &head {
        Head::Branch { name, oid } => match remote::resolve_upstream(repo, name, None)? {
            Some(upstream) => repo.graph_ahead_behind(*oid, upstream.oid)?,
            None => (0, 0),
        },
        Head::Unborn { branch } => match remote::resolve_upstream(repo, branch, None)? {
            Some(upstream) => (0, count_commits(repo, upstream.oid)?),
            None => (0, 0),
        },
        Head::Detached(_) => (0, 0),
    };

    let last_commit = head
        .oid()
        .map(|oid| history::commit_info(repo, oid))
        .transpose()?;

    let in_progress = match repo.state() {
        RepositoryState::Clean => None,
        RepositoryState::Merge => Some("merge".to_owned()),
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge => Some("rebase".to_owned()),
        _ => Some("other".to_owned()),
    };

    Ok(RepoStatus {
        is_repo: true,
        branch: head.branch_name().map(str::to_owned),
        detached: matches!(head, Head::Detached(_)),
        remote_url,
        dirty_files: u32::try_from(changes.total()).unwrap_or(u32::MAX),
        ahead: u32::try_from(ahead).unwrap_or(u32::MAX),
        behind: u32::try_from(behind).unwrap_or(u32::MAX),
        last_commit,
        in_progress,
    })
}

fn count_commits(repo: &Repository, from: git2::Oid) -> AppResult<usize> {
    let mut walk = repo.revwalk()?;
    walk.push(from)?;
    Ok(walk.take(10_000).count())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_plain_folder_and_fresh_repo() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!status(dir.path()).unwrap().is_repo);

        crate::git::init(dir.path()).unwrap();
        let s = status(dir.path()).unwrap();
        assert!(s.is_repo);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.dirty_files, 0);
        assert!(s.last_commit.is_none());

        std::fs::write(dir.path().join("a.md"), "hi").unwrap();
        assert_eq!(status(dir.path()).unwrap().dirty_files, 1);
    }
}
