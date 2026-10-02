//! Staging, committing and HEAD inspection.

use git2::{ErrorCode, IndexAddOption, Oid, Repository, Signature, Status, StatusOptions};

use crate::error::{AppError, AppResult};

/// Commit author, taken from settings (never from the user's global git config).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Author {
    pub name: String,
    pub email: String,
}

impl Author {
    pub fn signature(&self) -> AppResult<Signature<'static>> {
        let name = non_empty(&self.name, "git-notes");
        let email = non_empty(&self.email, "git-notes@localhost");
        Ok(Signature::now(name, email)?)
    }
}

fn non_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    }
}

/// Counts of working-tree changes relative to HEAD.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ChangeSummary {
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
}

impl ChangeSummary {
    pub fn total(&self) -> usize {
        self.added + self.modified + self.deleted
    }

    pub fn is_empty(&self) -> bool {
        self.total() == 0
    }
}

/// Working-tree + index changes versus HEAD, ignoring ignored files.
pub fn changes(repo: &Repository) -> AppResult<ChangeSummary> {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .exclude_submodules(true)
        .include_ignored(false);
    let statuses = repo.statuses(Some(&mut options))?;
    let mut summary = ChangeSummary::default();
    for entry in statuses.iter() {
        let status = entry.status();
        if status.intersects(Status::IGNORED) {
            continue;
        }
        if status.intersects(Status::WT_NEW | Status::INDEX_NEW) {
            summary.added += 1;
        } else if status.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
            summary.deleted += 1;
        } else if !status.is_empty() {
            summary.modified += 1;
        }
    }
    Ok(summary)
}

/// Stages every change (new, modified and deleted files) and returns what was staged.
pub fn stage_all(repo: &Repository) -> AppResult<ChangeSummary> {
    let summary = changes(repo)?;
    if summary.is_empty() {
        return Ok(summary);
    }
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"].iter(), None)?;
    index.write()?;
    Ok(summary)
}

/// Commits the current index on HEAD (creating the branch if HEAD is unborn).
pub fn commit_index(repo: &Repository, signature: &Signature<'_>, message: &str) -> AppResult<Oid> {
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit()?),
        Err(e) if e.code() == ErrorCode::UnbornBranch || e.code() == ErrorCode::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
    Ok(repo.commit(Some("HEAD"), signature, signature, message, &tree, &parents)?)
}

/// Commit message for an automatic sync commit, e.g. `sync: 3 files from pixel-8`.
pub fn sync_message(summary: &ChangeSummary, device: &str) -> String {
    let n = summary.total();
    let noun = if n == 1 { "file" } else { "files" };
    format!("sync: {n} {noun} from {device}")
}

/// Stages and commits all local changes if there are any.
pub fn commit_all_if_dirty(
    repo: &Repository,
    author: &Author,
    device: &str,
) -> AppResult<Option<(Oid, ChangeSummary)>> {
    let summary = stage_all(repo)?;
    if summary.is_empty() {
        return Ok(None);
    }
    let signature = author.signature()?;
    let oid = commit_index(repo, &signature, &sync_message(&summary, device))?;
    Ok(Some((oid, summary)))
}

/// Where HEAD points.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Head {
    /// Branch exists only as a name; no commits yet.
    Unborn {
        branch: String,
    },
    Detached(Oid),
    Branch {
        name: String,
        oid: Oid,
    },
}

impl Head {
    pub fn oid(&self) -> Option<Oid> {
        match self {
            Self::Unborn { .. } => None,
            Self::Detached(oid) | Self::Branch { oid, .. } => Some(*oid),
        }
    }

    pub fn branch_name(&self) -> Option<&str> {
        match self {
            Self::Unborn { branch } | Self::Branch { name: branch, .. } => Some(branch),
            Self::Detached(_) => None,
        }
    }
}

pub fn head(repo: &Repository) -> AppResult<Head> {
    match repo.head() {
        Ok(reference) => {
            let oid = reference
                .target()
                .ok_or_else(|| AppError::internal("HEAD has no target"))?;
            if repo.head_detached()? {
                Ok(Head::Detached(oid))
            } else {
                let name = reference.shorthand()?.to_owned();
                Ok(Head::Branch { name, oid })
            }
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch || e.code() == ErrorCode::NotFound => {
            let head = repo.find_reference("HEAD")?;
            let target = head
                .symbolic_target()?
                .unwrap_or("refs/heads/main")
                .trim_start_matches("refs/heads/")
                .to_owned();
            Ok(Head::Unborn { branch: target })
        }
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn author() -> Author {
        Author {
            name: "Tester".into(),
            email: "t@example.com".into(),
        }
    }

    #[test]
    fn commits_changes_and_reports_counts() {
        let dir = tempfile::tempdir().unwrap();
        let repo = crate::git::init(dir.path()).unwrap();
        assert!(matches!(head(&repo).unwrap(), Head::Unborn { ref branch } if branch == "main"));
        assert_eq!(commit_all_if_dirty(&repo, &author(), "dev").unwrap(), None);

        std::fs::write(dir.path().join("a.md"), "# A\n").unwrap();
        std::fs::write(dir.path().join("b.md"), "# B\n").unwrap();
        let (_, summary) = commit_all_if_dirty(&repo, &author(), "dev")
            .unwrap()
            .unwrap();
        assert_eq!(
            summary,
            ChangeSummary {
                added: 2,
                modified: 0,
                deleted: 0
            }
        );
        assert!(matches!(head(&repo).unwrap(), Head::Branch { ref name, .. } if name == "main"));
        let commit = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(commit.message().unwrap(), "sync: 2 files from dev");
        assert_eq!(commit.author().name().unwrap(), "Tester");

        std::fs::write(dir.path().join("a.md"), "# A2\n").unwrap();
        std::fs::remove_file(dir.path().join("b.md")).unwrap();
        let (_, summary) = commit_all_if_dirty(&repo, &author(), "dev")
            .unwrap()
            .unwrap();
        assert_eq!(
            summary,
            ChangeSummary {
                added: 0,
                modified: 1,
                deleted: 1
            }
        );
        assert_eq!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .message()
                .unwrap(),
            "sync: 2 files from dev"
        );
        assert!(changes(&repo).unwrap().is_empty());
    }

    #[test]
    fn temp_files_are_excluded() {
        let dir = tempfile::tempdir().unwrap();
        let repo = crate::git::init(dir.path()).unwrap();
        std::fs::write(dir.path().join(".note.md.tmp"), "partial").unwrap();
        assert!(changes(&repo).unwrap().is_empty());
    }

    #[test]
    fn empty_author_falls_back() {
        let sig = Author {
            name: " ".into(),
            email: String::new(),
        }
        .signature()
        .unwrap();
        assert_eq!(sig.name().unwrap(), "git-notes");
        assert_eq!(sig.email().unwrap(), "git-notes@localhost");
    }
}
