//! File tree of a notebook: directories first, case-insensitive order, hidden entries
//! and git internals excluded.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::paths;
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    /// Notebook-relative path with `/` separators.
    pub path: String,
    pub kind: EntryKind,
    /// Always present (empty for files) so the TypeScript type stays a single shape.
    pub children: Vec<TreeNode>,
}

/// Lists the whole notebook as a tree. Hidden files (dot-prefixed) and anything matched by
/// `.gitignore` are skipped, so `.git/`, editor swap files and `node_modules` never show up.
pub fn list_tree(root: &Path) -> AppResult<Vec<TreeNode>> {
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .sort_by_file_name(|a, b| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()))
        .build();

    // Collect entries keyed by their relative path, then stitch them into a tree.
    let mut nodes: BTreeMap<String, TreeNode> = BTreeMap::new();
    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                tracing::warn!(%error, "skipping unreadable entry");
                continue;
            }
        };
        if entry.depth() == 0 {
            continue;
        }
        let rel = paths::to_rel(root, entry.path())?;
        let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
        nodes.insert(
            rel.clone(),
            TreeNode {
                name: paths::file_name(&rel).to_owned(),
                path: rel,
                kind: if is_dir {
                    EntryKind::Dir
                } else {
                    EntryKind::File
                },
                children: Vec::new(),
            },
        );
    }

    // Deepest paths first so every child is attached before its parent is moved.
    let mut keys: Vec<String> = nodes.keys().cloned().collect();
    keys.sort_by_key(|k| std::cmp::Reverse(k.matches('/').count()));
    let mut top = Vec::new();
    for key in keys {
        let Some(node) = nodes.remove(&key) else {
            continue;
        };
        let parent = paths::parent(&key);
        if parent.is_empty() {
            top.push(node);
        } else if let Some(parent_node) = nodes.get_mut(parent) {
            parent_node.children.push(node);
        } else {
            // Parent was filtered out (should not happen with the walker above); keep it visible.
            top.push(node);
        }
    }
    sort_nodes(&mut top);
    Ok(top)
}

fn sort_nodes(nodes: &mut [TreeNode]) {
    nodes.sort_by(|a, b| {
        (a.kind != EntryKind::Dir)
            .cmp(&(b.kind != EntryKind::Dir))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    for node in nodes {
        sort_nodes(&mut node.children);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn builds_sorted_tree_without_hidden_entries() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fs::create_dir_all(r.join("Zeta")).unwrap();
        fs::create_dir_all(r.join("alpha/nested")).unwrap();
        fs::create_dir_all(r.join(".git/objects")).unwrap();
        fs::write(r.join("b.md"), "").unwrap();
        fs::write(r.join("A.md"), "").unwrap();
        fs::write(r.join(".hidden.md"), "").unwrap();
        fs::write(r.join("alpha/nested/deep.md"), "").unwrap();
        fs::write(r.join("alpha/x.md"), "").unwrap();
        fs::write(r.join(".gitignore"), "ignored.md\n").unwrap();
        fs::write(r.join("ignored.md"), "").unwrap();

        let tree = list_tree(r).unwrap();
        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "Zeta", "A.md", "b.md"]);

        let alpha = &tree[0];
        assert_eq!(alpha.kind, EntryKind::Dir);
        let alpha_names: Vec<&str> = alpha.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(alpha_names, vec!["nested", "x.md"]);
        assert_eq!(alpha.children[0].children[0].path, "alpha/nested/deep.md");
    }

    #[test]
    fn empty_notebook_is_empty_tree() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_tree(dir.path()).unwrap().is_empty());
    }
}
