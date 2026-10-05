//! Wiki links between notes (`[[Note]]`, `[[folder/Note#Heading|alias]]`, `![[Note]]`).
//!
//! This module only *reads and rewrites* link text. Resolving a link target to a file is
//! done by the frontend (`src/lib/wikilinks.ts`), which already knows the file tree, so the
//! resolution rules live in exactly one place. Links inside fenced code blocks and inline
//! code spans are ignored, like Markdown renderers do.

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::{files, paths, search};
use crate::error::AppResult;

/// One `[[…]]` occurrence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WikiLink {
    /// The note part as written (`folder/Note`), trimmed; empty for `[[#Heading]]`.
    pub target: String,
    pub heading: Option<String>,
    pub alias: Option<String>,
    /// 1-based line number.
    pub line_no: u32,
    /// The line, trimmed and shortened for display.
    pub line: String,
}

/// All wiki links of one note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinks {
    pub path: String,
    pub links: Vec<WikiLink>,
}

/// Replace the note part `from` (compared like targets are resolved: case-insensitive,
/// without `.md`) with `to`; heading and alias are kept as written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkReplacement {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkRewrite {
    pub path: String,
    pub replacements: Vec<LinkReplacement>,
}

/// Longest line excerpt returned with a link, in chars.
const MAX_LINE_CHARS: usize = 200;

/// Every note that contains at least one wiki link.
pub fn scan(root: &Path) -> AppResult<Vec<NoteLinks>> {
    let mut out = Vec::new();
    for (path, text) in search::notes(root) {
        let links = parse(&text);
        if !links.is_empty() {
            out.push(NoteLinks {
                path: paths::to_rel(root, &path)?,
                links,
            });
        }
    }
    Ok(out)
}

/// Applies `rewrites`; returns how many files changed.
pub fn rewrite(root: &Path, rewrites: &[LinkRewrite]) -> AppResult<u32> {
    let mut changed = 0;
    for rewrite in rewrites {
        let abs = paths::resolve(root, &rewrite.path)?;
        let text = match std::fs::read_to_string(&abs) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let pairs: Vec<(String, &str)> = rewrite
            .replacements
            .iter()
            .map(|r| (normalize_target(&r.from), r.to.as_str()))
            .collect();
        let (next, count) = replace_links(&text, &pairs);
        if count > 0 && next != text {
            files::write_text(root, &rewrite.path, &next)?;
            changed += 1;
        }
    }
    Ok(changed)
}

/// Comparison form of a link target: trimmed, no leading `./` or `/`, forward slashes,
/// no Markdown extension, lower case. Mirrors `normalizeTarget` in `src/lib/wikilinks.ts`.
pub fn normalize_target(target: &str) -> String {
    let mut t = target.trim().replace('\\', "/");
    while let Some(rest) = t.strip_prefix("./") {
        t = rest.to_owned();
    }
    let lower = t.trim_start_matches('/').to_lowercase();
    for ext in [".markdown", ".md"] {
        if let Some(stem) = lower.strip_suffix(ext) {
            return stem.to_owned();
        }
    }
    lower
}

/// A `[[…]]` found in a line: byte range of the inner text (between the brackets).
struct Found {
    inner_start: usize,
    inner_end: usize,
}

/// Finds wiki links in one line outside inline code spans.
fn find_in_line(line: &str) -> Vec<Found> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'`' => {
                // Skip an inline code span: a run of N backticks up to the next run of N.
                let run = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                let mut j = i + run;
                let mut closed = None;
                while j < bytes.len() {
                    if bytes[j] == b'`' {
                        let other = bytes[j..].iter().take_while(|&&b| b == b'`').count();
                        if other == run {
                            closed = Some(j + other);
                            break;
                        }
                        j += other;
                    } else {
                        j += 1;
                    }
                }
                // An unclosed run is literal text.
                i = closed.unwrap_or(i + run);
            }
            b'[' if bytes.get(i + 1) == Some(&b'[') => {
                let start = i + 2;
                let mut j = start;
                let mut end = None;
                while j < bytes.len() {
                    match bytes[j] {
                        b']' if bytes.get(j + 1) == Some(&b']') => {
                            end = Some(j);
                            break;
                        }
                        b'[' | b']' => break,
                        _ => j += 1,
                    }
                }
                match end {
                    Some(end) if end > start && !line[start..end].trim().is_empty() => {
                        out.push(Found {
                            inner_start: start,
                            inner_end: end,
                        });
                        i = end + 2;
                    }
                    _ => i += 1,
                }
            }
            _ => i += 1,
        }
    }
    out
}

/// Splits the inner text into (note part, heading, alias).
fn split_inner(inner: &str) -> (String, Option<String>, Option<String>) {
    let (page, alias) = match inner.split_once('|') {
        Some((page, alias)) => (
            page,
            Some(alias.trim().to_owned()).filter(|a| !a.is_empty()),
        ),
        None => (inner, None),
    };
    let (target, heading) = match page.split_once('#') {
        Some((target, heading)) => (
            target,
            Some(heading.trim().to_owned()).filter(|h| !h.is_empty()),
        ),
        None => (page, None),
    };
    (target.trim().to_owned(), heading, alias)
}

/// Byte length of the note part inside `inner` (up to the first `#` or `|`).
fn note_part_len(inner: &str) -> usize {
    inner.find(['#', '|']).unwrap_or(inner.len())
}

/// Tracks fenced code blocks line by line.
#[derive(Default)]
struct Fences {
    open: Option<(u8, usize)>,
}

impl Fences {
    /// Feeds one line; returns true when the line is code (including the fence lines).
    fn is_code(&mut self, line: &str) -> bool {
        let indent = line.len() - line.trim_start_matches(' ').len();
        let rest = &line[indent..];
        let fence = if indent <= 3 {
            rest.as_bytes()
                .first()
                .copied()
                .filter(|&b| b == b'`' || b == b'~')
                .map(|ch| (ch, rest.bytes().take_while(|&b| b == ch).count()))
                .filter(|&(_, len)| len >= 3)
        } else {
            None
        };
        match (self.open, fence) {
            (None, Some(open)) => {
                self.open = Some(open);
                true
            }
            (Some((ch, len)), Some((c, l)))
                if c == ch && l >= len && rest[l..].trim().is_empty() =>
            {
                self.open = None;
                true
            }
            (Some(_), _) => true,
            (None, None) => false,
        }
    }
}

/// Every wiki link in `text`.
pub fn parse(text: &str) -> Vec<WikiLink> {
    let mut fences = Fences::default();
    let mut out = Vec::new();
    for (index, line) in text.lines().enumerate() {
        if fences.is_code(line) {
            continue;
        }
        for found in find_in_line(line) {
            let (target, heading, alias) = split_inner(&line[found.inner_start..found.inner_end]);
            out.push(WikiLink {
                target,
                heading,
                alias,
                line_no: u32::try_from(index + 1).unwrap_or(u32::MAX),
                line: excerpt(line),
            });
        }
    }
    out
}

fn excerpt(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= MAX_LINE_CHARS {
        return trimmed.to_owned();
    }
    let mut cut: String = trimmed.chars().take(MAX_LINE_CHARS).collect();
    cut.push('…');
    cut
}

/// Rewrites the note part of matching links. `pairs` holds (normalized from, new target).
/// Returns the new text and the number of links changed.
fn replace_links(text: &str, pairs: &[(String, &str)]) -> (String, usize) {
    let mut fences = Fences::default();
    let mut out = String::with_capacity(text.len());
    let mut count = 0;
    for chunk in text.split_inclusive('\n') {
        let line = chunk.trim_end_matches(['\n', '\r']);
        let ending = &chunk[line.len()..];
        if fences.is_code(line) {
            out.push_str(chunk);
            continue;
        }
        let mut last = 0;
        for found in find_in_line(line) {
            let inner = &line[found.inner_start..found.inner_end];
            let part_len = note_part_len(inner);
            let current = normalize_target(&inner[..part_len]);
            if current.is_empty() {
                continue;
            }
            let Some((_, to)) = pairs.iter().find(|(from, _)| *from == current) else {
                continue;
            };
            out.push_str(&line[last..found.inner_start]);
            out.push_str(to);
            out.push_str(&inner[part_len..]);
            last = found.inner_end;
            count += 1;
        }
        out.push_str(&line[last..]);
        out.push_str(ending);
    }
    (out, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(text: &str) -> Vec<String> {
        parse(text).into_iter().map(|l| l.target).collect()
    }

    #[test]
    fn parses_targets_headings_and_aliases() {
        let links = parse("See [[Ideas]] and [[Projects/Roadmap#Q4|the plan]].\n![[Diagram]]");
        assert_eq!(links.len(), 3);
        assert_eq!(links[0].target, "Ideas");
        assert_eq!(links[0].line_no, 1);
        assert_eq!(links[1].target, "Projects/Roadmap");
        assert_eq!(links[1].heading.as_deref(), Some("Q4"));
        assert_eq!(links[1].alias.as_deref(), Some("the plan"));
        assert_eq!(links[2].target, "Diagram");
        assert_eq!(links[2].line_no, 2);
    }

    #[test]
    fn ignores_code_and_malformed_links() {
        let text = "`[[inline]]` and ``[[`x`]]`` [[ok]]\n```\n[[fenced]]\n```\n~~~~md\n[[tilde]]\n~~~~\n[[]] [[ ]] [[a[b]] [[open\n[[after]]";
        assert_eq!(targets(text), ["ok", "after"]);
    }

    #[test]
    fn heading_only_links_have_an_empty_target() {
        let links = parse("[[#Top]]");
        assert_eq!(links[0].target, "");
        assert_eq!(links[0].heading.as_deref(), Some("Top"));
    }

    #[test]
    fn handles_cyrillic() {
        let links = parse("Ссылка на [[Идеи|мои идеи]] здесь");
        assert_eq!(links[0].target, "Идеи");
        assert_eq!(links[0].alias.as_deref(), Some("мои идеи"));
    }

    #[test]
    fn normalizes_targets_for_comparison() {
        assert_eq!(normalize_target(" ./Folder/Note.md "), "folder/note");
        assert_eq!(normalize_target("/Идеи.MD"), "идеи");
        assert_eq!(normalize_target("a\\b"), "a/b");
    }

    #[test]
    fn replaces_note_part_and_keeps_heading_alias_and_code() {
        let text = "[[Old]] [[old#H|alias]] [[Other]]\r\n`[[Old]]`\n```\n[[Old]]\n```\n[[Old.md]]";
        let (next, count) = replace_links(text, &[("old".to_owned(), "New/Name")]);
        assert_eq!(count, 3);
        assert_eq!(
            next,
            "[[New/Name]] [[New/Name#H|alias]] [[Other]]\r\n`[[Old]]`\n```\n[[Old]]\n```\n[[New/Name]]"
        );
    }

    #[test]
    fn scan_and_rewrite_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Go to [[B]].\n").unwrap();
        std::fs::write(dir.path().join("b.md"), "No links.\n").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/c.md"), "[[a]] and [[b|bee]]\n").unwrap();

        let found = scan(dir.path()).unwrap();
        let paths: Vec<_> = found.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(paths, ["a.md", "sub/c.md"]);

        let replace_b = || {
            vec![LinkReplacement {
                from: "b".into(),
                to: "Bee".into(),
            }]
        };
        let changed = rewrite(
            dir.path(),
            &[
                LinkRewrite {
                    path: "a.md".into(),
                    replacements: replace_b(),
                },
                LinkRewrite {
                    path: "sub/c.md".into(),
                    replacements: replace_b(),
                },
                LinkRewrite {
                    path: "missing.md".into(),
                    replacements: replace_b(),
                },
            ],
        )
        .unwrap();
        assert_eq!(changed, 2);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "Go to [[Bee]].\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("sub/c.md")).unwrap(),
            "[[a]] and [[Bee|bee]]\n"
        );
    }
}
