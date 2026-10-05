//! Full-text search over the notes of a notebook.
//!
//! Plain scanning, no index: notebooks are folders of small Markdown files, and a scan of a
//! few thousand notes finishes well within a keystroke. Matching is case-insensitive and
//! every whitespace-separated term of the query must occur on the same line.

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::paths;
use crate::error::AppResult;

/// One matching line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    /// 1-based line number in the file.
    pub line_no: u32,
    /// The line, trimmed and windowed around the match for long lines (`…` marks cuts).
    pub line: String,
    /// Match of the first term inside `line`, as char offsets (not bytes).
    pub match_start: u32,
    pub match_end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub files_matched: u32,
    /// The hit limit was reached; more lines match than are listed.
    pub truncated: bool,
}

/// Lines per file after which further matches in that file are skipped, so one giant note
/// cannot crowd out the rest.
const MAX_HITS_PER_FILE: usize = 20;
/// Files above this size are skipped (they are not notes).
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Window shown around a match on long lines.
const WINDOW_CHARS: usize = 160;

pub fn search(root: &Path, query: &str, limit: usize) -> AppResult<SearchResults> {
    let terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    let mut results = SearchResults {
        hits: Vec::new(),
        files_matched: 0,
        truncated: false,
    };
    if terms.is_empty() || limit == 0 {
        return Ok(results);
    }

    'files: for (path, text) in notes(root) {
        let rel = paths::to_rel(root, &path)?;
        let mut in_file = 0usize;
        for (index, raw) in text.lines().enumerate() {
            let Some((start, end)) = line_match(raw, &terms) else {
                continue;
            };
            if in_file == 0 {
                results.files_matched += 1;
            }
            in_file += 1;
            if in_file > MAX_HITS_PER_FILE {
                break;
            }
            if results.hits.len() >= limit {
                results.truncated = true;
                break 'files;
            }
            let (line, match_start, match_end) = window(raw, start, end);
            results.hits.push(SearchHit {
                path: rel.clone(),
                line_no: u32::try_from(index + 1).unwrap_or(u32::MAX),
                line,
                match_start: u32::try_from(match_start).unwrap_or(u32::MAX),
                match_end: u32::try_from(match_end).unwrap_or(u32::MAX),
            });
        }
    }
    Ok(results)
}

/// The notes of a notebook as `(absolute path, text)`, sorted by file name per directory.
/// Hidden and git-ignored entries, binaries and files above [`MAX_FILE_BYTES`] are skipped.
pub(super) fn notes(root: &Path) -> impl Iterator<Item = (std::path::PathBuf, String)> {
    ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .sort_by_file_name(|a, b| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()))
        .build()
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry),
            Err(error) => {
                tracing::debug!(%error, "skipping unreadable entry");
                None
            }
        })
        .filter(|entry| entry.depth() > 0 && entry.file_type().is_some_and(|t| t.is_file()))
        .filter(|entry| is_note(entry.path()))
        .filter(|entry| !entry.metadata().is_ok_and(|m| m.len() > MAX_FILE_BYTES))
        .filter_map(|entry| {
            let bytes = std::fs::read(entry.path()).ok()?;
            if bytes.iter().take(8000).any(|&b| b == 0) {
                return None;
            }
            let text = String::from_utf8_lossy(&bytes).into_owned();
            Some((entry.into_path(), text))
        })
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown" | "txt"))
}

/// Case-folded view of a line: each lowered char remembers the char index it came from.
fn folded(line: &str) -> Vec<(usize, char)> {
    let mut out = Vec::with_capacity(line.len());
    for (index, c) in line.chars().enumerate() {
        for lc in c.to_lowercase() {
            out.push((index, lc));
        }
    }
    out
}

/// Char range (in the original line) of the first term when *all* terms occur on the line.
fn line_match(line: &str, terms: &[String]) -> Option<(usize, usize)> {
    let folded = folded(line);
    let mut first: Option<(usize, usize)> = None;
    for (i, term) in terms.iter().enumerate() {
        let needle: Vec<char> = term.chars().collect();
        let position = find_chars(&folded, &needle)?;
        if i == 0 {
            let start = folded[position].0;
            let end = folded
                .get(position + needle.len())
                .map_or(line.chars().count(), |(index, _)| *index);
            first = Some((start, end));
        }
    }
    first
}

fn find_chars(haystack: &[(usize, char)], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    (0..=haystack.len() - needle.len()).find(|&start| {
        haystack[start..start + needle.len()]
            .iter()
            .map(|(_, c)| *c)
            .eq(needle.iter().copied())
    })
}

/// Trims the line and, when it is long, keeps a window around the match.
fn window(raw: &str, start: usize, end: usize) -> (String, usize, usize) {
    let chars: Vec<char> = raw.chars().collect();
    let leading = chars.iter().take_while(|c| c.is_whitespace()).count();
    let trailing = chars.iter().rev().take_while(|c| c.is_whitespace()).count();
    let body_end = chars.len().saturating_sub(trailing).max(leading);
    let (start, end) = (
        start.max(leading),
        end.min(body_end).max(start.max(leading)),
    );
    if body_end - leading <= WINDOW_CHARS {
        return (
            chars[leading..body_end].iter().collect(),
            start - leading,
            end - leading,
        );
    }
    let half = WINDOW_CHARS / 2;
    let mut from = start.saturating_sub(half).max(leading);
    let mut to = (from + WINDOW_CHARS).min(body_end);
    if to - from < WINDOW_CHARS {
        from = to.saturating_sub(WINDOW_CHARS).max(leading);
    }
    if to < end {
        to = end.min(body_end);
    }
    let mut text = String::new();
    let mut offset = 0;
    if from > leading {
        text.push('…');
        offset = 1;
    }
    text.extend(&chars[from..to]);
    if to < body_end {
        text.push('…');
    }
    (text, start - from + offset, end - from + offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notebook() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("work/.hidden")).unwrap();
        std::fs::write(
            root.join("Welcome.md"),
            "# Welcome\n\nNotes are plain Markdown files.\nSync happens through git.\n",
        )
        .unwrap();
        std::fs::write(
            root.join("work/plan.md"),
            "# План\n\n- Написать Markdown заметку\n- проверить СИНК вечером\n",
        )
        .unwrap();
        std::fs::write(root.join("work/.hidden/secret.md"), "markdown hidden").unwrap();
        std::fs::write(root.join("image.png"), [0x89, b'P', b'N', b'G', 0, 1]).unwrap();
        std::fs::write(root.join("data.bin"), "markdown but not a note").unwrap();
        dir
    }

    #[test]
    fn finds_case_insensitive_matches_in_notes_only() {
        let dir = notebook();
        let results = search(dir.path(), "MARKDOWN", 100).unwrap();
        let paths: Vec<&str> = results.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec!["Welcome.md", "work/plan.md"]);
        assert_eq!(results.files_matched, 2);
        assert!(!results.truncated);

        let hit = &results.hits[0];
        assert_eq!(hit.line_no, 3);
        assert_eq!(hit.line, "Notes are plain Markdown files.");
        let start = usize::try_from(hit.match_start).unwrap();
        let end = usize::try_from(hit.match_end).unwrap();
        assert_eq!(&hit.line[start..end], "Markdown");
    }

    #[test]
    fn handles_cyrillic_case_folding_and_multiple_terms() {
        let dir = notebook();
        let results = search(dir.path(), "синк вечером", 100).unwrap();
        assert_eq!(results.hits.len(), 1);
        let hit = &results.hits[0];
        assert_eq!(hit.path, "work/plan.md");
        assert_eq!(hit.line, "- проверить СИНК вечером");
        let chars: Vec<char> = hit.line.chars().collect();
        let matched: String = chars
            [usize::try_from(hit.match_start).unwrap()..usize::try_from(hit.match_end).unwrap()]
            .iter()
            .collect();
        assert_eq!(matched, "СИНК");

        assert!(
            search(dir.path(), "синк утром", 100)
                .unwrap()
                .hits
                .is_empty()
        );
        assert!(search(dir.path(), "   ", 100).unwrap().hits.is_empty());
    }

    #[test]
    fn limits_hits_per_file_and_in_total() {
        let dir = tempfile::tempdir().unwrap();
        let many: String = (0..50).map(|i| format!("word {i}\n")).collect();
        std::fs::write(dir.path().join("a.md"), &many).unwrap();
        std::fs::write(dir.path().join("b.md"), &many).unwrap();

        let results = search(dir.path(), "word", 1000).unwrap();
        assert_eq!(results.hits.len(), 2 * MAX_HITS_PER_FILE);
        assert_eq!(results.files_matched, 2);
        assert!(!results.truncated);

        let capped = search(dir.path(), "word", 5).unwrap();
        assert_eq!(capped.hits.len(), 5);
        assert!(capped.truncated);
    }

    #[test]
    fn long_lines_are_windowed_around_the_match() {
        let dir = tempfile::tempdir().unwrap();
        let line = format!("{}needle{}", "a".repeat(300), "b".repeat(300));
        std::fs::write(dir.path().join("long.md"), format!("  {line}  \n")).unwrap();
        let results = search(dir.path(), "needle", 10).unwrap();
        let hit = &results.hits[0];
        assert!(hit.line.starts_with('…') && hit.line.ends_with('…'));
        assert!(hit.line.chars().count() <= WINDOW_CHARS + 2);
        let chars: Vec<char> = hit.line.chars().collect();
        let matched: String = chars
            [usize::try_from(hit.match_start).unwrap()..usize::try_from(hit.match_end).unwrap()]
            .iter()
            .collect();
        assert_eq!(matched, "needle");
    }
}
