//! Full-text search over the notes of a notebook.
//!
//! Plain scanning, no index: notebooks are folders of small Markdown files, and a scan of a
//! few thousand notes finishes well within a keystroke.
//!
//! A query is a list of terms; a note matches when every term occurs somewhere in it (body
//! or file name), case-insensitively. Besides plain words the query understands
//! `"exact phrase"`, `tag:name` (or `#name`; nested tags match too) and `path:part`.
//! Results are grouped by note, notes whose title matches come first, then notes with more
//! matching lines.

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::{paths, tags};
use crate::error::AppResult;

/// A highlighted range inside [`SearchHit::line`], in chars (not bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MatchRange {
    pub start: u32,
    pub end: u32,
}

/// One matching line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// 1-based line number in the file.
    pub line_no: u32,
    /// The line, trimmed and windowed around the first match for long lines (`…` marks cuts).
    pub line: String,
    /// Every occurrence of every term inside `line`.
    pub ranges: Vec<MatchRange>,
}

/// One matching note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteMatch {
    pub path: String,
    /// Some term occurs in the file name.
    pub title_match: bool,
    /// Lines with a match (at most [`MAX_HITS_PER_FILE`]).
    pub hits: Vec<SearchHit>,
    /// Matching lines beyond `hits`.
    pub more_hits: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub notes: Vec<NoteMatch>,
    /// The note limit was reached; more notes match than are listed.
    pub truncated: bool,
    /// The plain terms of the query (lower case), for highlighting in the editor.
    pub terms: Vec<String>,
}

/// Lines per note after which further matches are only counted.
pub const MAX_HITS_PER_FILE: usize = 20;
/// Files above this size are skipped (they are not notes).
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Window shown around a match on long lines.
const WINDOW_CHARS: usize = 160;

/// A parsed query.
#[derive(Debug, Default, PartialEq, Eq)]
struct Query {
    terms: Vec<String>,
    tags: Vec<String>,
    paths: Vec<String>,
}

impl Query {
    fn parse(query: &str) -> Self {
        let mut out = Self::default();
        for (quoted, text) in tokenize(query) {
            let lower = text.to_lowercase();
            if !quoted {
                if let Some(tag) = lower
                    .strip_prefix("tag:")
                    .or_else(|| lower.strip_prefix('#'))
                {
                    if !tag.is_empty() {
                        out.tags.push(tag.to_owned());
                    }
                    continue;
                }
                if let Some(path) = lower.strip_prefix("path:") {
                    if !path.is_empty() {
                        out.paths.push(path.to_owned());
                    }
                    continue;
                }
            }
            if !lower.trim().is_empty() {
                out.terms.push(lower);
            }
        }
        out
    }

    fn is_empty(&self) -> bool {
        self.terms.is_empty() && self.tags.is_empty() && self.paths.is_empty()
    }
}

/// Splits on whitespace, keeping `"quoted phrases"` together. Returns (quoted, text).
fn tokenize(query: &str) -> Vec<(bool, String)> {
    let mut out = Vec::new();
    let mut chars = query.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c == '"' {
            chars.next();
            let phrase: String = chars.by_ref().take_while(|&c| c != '"').collect();
            if !phrase.trim().is_empty() {
                out.push((true, phrase.trim().to_owned()));
            }
        } else {
            let mut word = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_whitespace() {
                    break;
                }
                word.push(c);
                chars.next();
            }
            out.push((false, word));
        }
    }
    out
}

pub fn search(root: &Path, query: &str, limit: usize) -> AppResult<SearchResults> {
    let query = Query::parse(query);
    let mut results = SearchResults {
        notes: Vec::new(),
        truncated: false,
        terms: query.terms.clone(),
    };
    if query.is_empty() || limit == 0 {
        return Ok(results);
    }

    let mut scored: Vec<(usize, NoteMatch)> = Vec::new();
    for (path, text) in notes(root) {
        let rel = paths::to_rel(root, &path)?;
        if let Some(found) = match_note(&rel, &text, &query) {
            scored.push(found);
        }
    }
    scored.sort_by(|(a, x), (b, y)| b.cmp(a).then_with(|| x.path.cmp(&y.path)));
    results.truncated = scored.len() > limit;
    results.notes = scored.into_iter().take(limit).map(|(_, m)| m).collect();
    Ok(results)
}

/// The note's match and its score, or None when it does not match.
fn match_note(rel: &str, text: &str, query: &Query) -> Option<(usize, NoteMatch)> {
    let rel_lower = rel.to_lowercase();
    if !query.paths.iter().all(|p| rel_lower.contains(p.as_str())) {
        return None;
    }
    if !query.tags.is_empty() {
        let note_tags = tags::extract(text);
        let all = query
            .tags
            .iter()
            .all(|filter| note_tags.iter().any(|tag| tags::matches(tag, filter)));
        if !all {
            return None;
        }
    }
    let title = title_of(rel).to_lowercase();
    let body = text.to_lowercase();
    if !query
        .terms
        .iter()
        .all(|t| title.contains(t.as_str()) || body.contains(t.as_str()))
    {
        return None;
    }
    let title_terms = query
        .terms
        .iter()
        .filter(|t| title.contains(t.as_str()))
        .count();

    let mut hits = Vec::new();
    let mut matching_lines = 0usize;
    if !query.terms.is_empty() {
        for (index, raw) in text.lines().enumerate() {
            let ranges = line_ranges(raw, &query.terms);
            if ranges.is_empty() {
                continue;
            }
            matching_lines += 1;
            if hits.len() < MAX_HITS_PER_FILE {
                let (line, ranges) = window(raw, &ranges);
                hits.push(SearchHit {
                    line_no: u32::try_from(index + 1).unwrap_or(u32::MAX),
                    line,
                    ranges,
                });
            }
        }
    }
    let all_in_title = !query.terms.is_empty() && title_terms == query.terms.len();
    let score = usize::from(all_in_title) * 10_000 + title_terms * 1_000 + matching_lines.min(999);
    Some((
        score,
        NoteMatch {
            path: rel.to_owned(),
            title_match: title_terms > 0,
            hits,
            more_hits: u32::try_from(matching_lines.saturating_sub(MAX_HITS_PER_FILE))
                .unwrap_or(u32::MAX),
        },
    ))
}

/// `folder/Note.md` → `Note`
fn title_of(rel: &str) -> &str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
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

/// Char ranges (in the original line) of every occurrence of every term, sorted and merged.
fn line_ranges(line: &str, terms: &[String]) -> Vec<(usize, usize)> {
    let folded = folded(line);
    let line_len = line.chars().count();
    let mut ranges = Vec::new();
    for term in terms {
        let needle: Vec<char> = term.chars().collect();
        if needle.is_empty() || needle.len() > folded.len() {
            continue;
        }
        let mut from = 0;
        while from + needle.len() <= folded.len() {
            let found = (from..=folded.len() - needle.len()).find(|&start| {
                folded[start..start + needle.len()]
                    .iter()
                    .map(|(_, c)| *c)
                    .eq(needle.iter().copied())
            });
            let Some(position) = found else { break };
            let start = folded[position].0;
            let end = folded
                .get(position + needle.len())
                .map_or(line_len, |(index, _)| *index);
            ranges.push((start, end));
            from = position + needle.len();
        }
    }
    ranges.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(ranges.len());
    for (start, end) in ranges {
        match merged.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => merged.push((start, end)),
        }
    }
    merged
}

/// Trims the line and, when it is long, keeps a window around the first match. Ranges are
/// shifted into the returned text; those outside the window are dropped.
fn window(raw: &str, ranges: &[(usize, usize)]) -> (String, Vec<MatchRange>) {
    let chars: Vec<char> = raw.chars().collect();
    let leading = chars.iter().take_while(|c| c.is_whitespace()).count();
    let trailing = chars.iter().rev().take_while(|c| c.is_whitespace()).count();
    let body_end = chars.len().saturating_sub(trailing).max(leading);
    let (first_start, first_end) = ranges.first().copied().unwrap_or((leading, leading));

    let (from, to) = if body_end - leading <= WINDOW_CHARS {
        (leading, body_end)
    } else {
        let half = WINDOW_CHARS / 2;
        let mut from = first_start.saturating_sub(half).max(leading);
        let mut to = (from + WINDOW_CHARS).min(body_end);
        if to - from < WINDOW_CHARS {
            from = to.saturating_sub(WINDOW_CHARS).max(leading);
        }
        if to < first_end {
            to = first_end.min(body_end);
        }
        (from, to)
    };
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
    let shifted = ranges
        .iter()
        .filter_map(|&(start, end)| {
            let start = start.max(from);
            let end = end.min(to);
            (start < end).then(|| MatchRange {
                start: u32::try_from(start - from + offset).unwrap_or(u32::MAX),
                end: u32::try_from(end - from + offset).unwrap_or(u32::MAX),
            })
        })
        .collect();
    (text, shifted)
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
            "# План #work/q4\n\n- Написать Markdown заметку\n- проверить СИНК вечером\n",
        )
        .unwrap();
        std::fs::write(root.join("work/.hidden/secret.md"), "markdown hidden").unwrap();
        std::fs::write(root.join("image.png"), [0x89, b'P', b'N', b'G', 0, 1]).unwrap();
        std::fs::write(root.join("data.bin"), "markdown but not a note").unwrap();
        dir
    }

    fn text_of(hit: &SearchHit, range: MatchRange) -> String {
        hit.line
            .chars()
            .skip(range.start as usize)
            .take((range.end - range.start) as usize)
            .collect()
    }

    #[test]
    fn finds_case_insensitive_matches_in_notes_only() {
        let dir = notebook();
        let results = search(dir.path(), "MARKDOWN", 100).unwrap();
        let paths: Vec<&str> = results.notes.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(paths, vec!["Welcome.md", "work/plan.md"]);
        assert!(!results.truncated);
        assert_eq!(results.terms, vec!["markdown"]);

        let hit = &results.notes[0].hits[0];
        assert_eq!(hit.line_no, 3);
        assert_eq!(hit.line, "Notes are plain Markdown files.");
        assert_eq!(text_of(hit, hit.ranges[0]), "Markdown");
    }

    #[test]
    fn terms_may_be_on_different_lines_and_title_matches_rank_first() {
        let dir = notebook();
        let results = search(dir.path(), "markdown синк", 100).unwrap();
        assert_eq!(results.notes.len(), 1);
        let note = &results.notes[0];
        assert_eq!(note.path, "work/plan.md");
        assert_eq!(note.hits.len(), 2);
        assert_eq!(text_of(&note.hits[1], note.hits[1].ranges[0]), "СИНК");

        // "welcome" is in the title of Welcome.md; about.md only mentions it.
        std::fs::write(dir.path().join("about.md"), "welcome welcome welcome\n").unwrap();
        let ranked = search(dir.path(), "welcome", 100).unwrap();
        assert_eq!(ranked.notes[0].path, "Welcome.md");
        assert!(ranked.notes[0].title_match);
        assert!(!ranked.notes[1].title_match);

        assert!(search(dir.path(), "   ", 100).unwrap().notes.is_empty());
    }

    #[test]
    fn understands_phrases_tags_and_paths() {
        let dir = notebook();
        let phrase = search(dir.path(), "\"plain markdown\"", 100).unwrap();
        assert_eq!(phrase.notes.len(), 1);
        assert_eq!(phrase.notes[0].path, "Welcome.md");
        assert!(
            search(dir.path(), "\"markdown plain\"", 100)
                .unwrap()
                .notes
                .is_empty()
        );

        let tagged = search(dir.path(), "tag:work", 100).unwrap();
        assert_eq!(tagged.notes.len(), 1);
        assert_eq!(tagged.notes[0].path, "work/plan.md");
        assert!(tagged.notes[0].hits.is_empty());
        assert_eq!(
            search(dir.path(), "#WORK/q4 markdown", 100)
                .unwrap()
                .notes
                .len(),
            1
        );
        assert!(search(dir.path(), "tag:q4", 100).unwrap().notes.is_empty());

        let by_path = search(dir.path(), "path:work markdown", 100).unwrap();
        assert_eq!(by_path.notes.len(), 1);
    }

    #[test]
    fn limits_notes_and_hits_per_note() {
        let dir = tempfile::tempdir().unwrap();
        let many: String = (0..50).map(|i| format!("word {i}\n")).collect();
        std::fs::write(dir.path().join("a.md"), &many).unwrap();
        std::fs::write(dir.path().join("b.md"), &many).unwrap();

        let results = search(dir.path(), "word", 1000).unwrap();
        assert_eq!(results.notes.len(), 2);
        assert_eq!(results.notes[0].hits.len(), MAX_HITS_PER_FILE);
        assert_eq!(results.notes[0].more_hits, 30);

        let capped = search(dir.path(), "word", 1).unwrap();
        assert_eq!(capped.notes.len(), 1);
        assert!(capped.truncated);
    }

    #[test]
    fn long_lines_are_windowed_around_the_match() {
        let dir = tempfile::tempdir().unwrap();
        let line = format!("{}needle{}needle", "a".repeat(300), "b".repeat(300));
        std::fs::write(dir.path().join("long.md"), format!("  {line}  \n")).unwrap();
        let results = search(dir.path(), "needle", 10).unwrap();
        let hit = &results.notes[0].hits[0];
        assert!(hit.line.starts_with('…') && hit.line.ends_with('…'));
        assert!(hit.line.chars().count() <= WINDOW_CHARS + 2);
        // The second needle is outside the window.
        assert_eq!(hit.ranges.len(), 1);
        assert_eq!(text_of(hit, hit.ranges[0]), "needle");
    }

    #[test]
    fn highlights_every_occurrence_merged() {
        let ranges = line_ranges("Foo foo FOOBAR", &["foo".into(), "oob".into()]);
        assert_eq!(ranges, vec![(0, 3), (4, 7), (8, 12)]);
    }
}
