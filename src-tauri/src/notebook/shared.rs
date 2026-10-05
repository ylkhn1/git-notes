//! Saving text shared from another app (the Android share sheet) as a new note.

use std::path::Path;

use super::files;
use crate::error::{AppError, AppResult};

/// Longest file stem derived from a title, in characters.
const MAX_STEM_CHARS: usize = 80;
/// Longest title taken from the first line of untitled text.
const MAX_DERIVED_TITLE_CHARS: usize = 60;

/// Writes `text` as a new note at the notebook root and returns its relative path.
///
/// The note is named after `title` (the share sheet's subject, e.g. a page title), else after
/// the first line of the text (the host for a bare URL), else after `fallback_title` (a
/// timestamp). A title that did not come from the text itself becomes a level-1 heading.
pub fn save_shared(
    root: &Path,
    title: Option<&str>,
    text: &str,
    fallback_title: &str,
) -> AppResult<String> {
    let text = text.trim_start_matches(['\n', '\r']).trim_end();
    let title = title.map(str::trim).filter(|t| !t.is_empty());
    if title.is_none() && text.trim().is_empty() {
        return Err(AppError::invalid_input("nothing to save"));
    }
    let (stem_source, body) = match title {
        Some(title) if text.trim().is_empty() => (title.to_owned(), format!("# {title}")),
        Some(title) if starts_with_heading(text) => (title.to_owned(), text.to_owned()),
        Some(title) => (title.to_owned(), format!("# {title}\n\n{text}")),
        None => (
            first_line_title(text).unwrap_or_else(|| fallback_title.to_owned()),
            text.to_owned(),
        ),
    };
    let mut stem = file_stem(&stem_source);
    if stem.is_empty() {
        stem = file_stem(fallback_title);
    }
    if stem.is_empty() {
        stem = "Shared note".to_owned();
    }
    let name = unique_name(root, &stem);
    files::write_text(root, &name, &format!("{body}\n"))?;
    Ok(name)
}

fn starts_with_heading(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with('#') && t.trim_start_matches('#').starts_with(' ')
}

/// First non-empty line, without Markdown heading markers; the host for a bare URL.
fn first_line_title(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    let line = line.trim_start_matches('#').trim();
    let title = if let Some(rest) = line
        .strip_prefix("https://")
        .or_else(|| line.strip_prefix("http://"))
    {
        rest.split(['/', '?', '#']).next().unwrap_or_default()
    } else {
        line
    };
    let title: String = title.chars().take(MAX_DERIVED_TITLE_CHARS).collect();
    let title = title.trim();
    (!title.is_empty()).then(|| title.to_owned())
}

/// A file stem that is valid on Linux, Windows and Android: no separators or reserved
/// punctuation, collapsed whitespace, no leading/trailing dots or spaces, bounded length.
fn file_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let stem: String = joined.chars().take(MAX_STEM_CHARS).collect();
    stem.trim_matches(|c| c == '.' || c == ' ').to_owned()
}

/// `stem.md`, or `stem 2.md`, `stem 3.md`, … — whichever does not exist yet.
fn unique_name(root: &Path, stem: &str) -> String {
    let mut n = 1u32;
    loop {
        let name = if n == 1 {
            format!("{stem}.md")
        } else {
            format!("{stem} {n}.md")
        };
        if !root.join(&name).exists() {
            return name;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(root: &Path, name: &str) -> String {
        std::fs::read_to_string(root.join(name)).unwrap()
    }

    #[test]
    fn subject_becomes_file_name_and_heading() {
        let dir = tempfile::tempdir().unwrap();
        let name = save_shared(dir.path(), Some(" My Page "), "some text\n\n", "fb").unwrap();
        assert_eq!(name, "My Page.md");
        assert_eq!(read(dir.path(), &name), "# My Page\n\nsome text\n");
    }

    #[test]
    fn text_that_already_has_a_heading_is_kept_as_is() {
        let dir = tempfile::tempdir().unwrap();
        let name = save_shared(dir.path(), Some("X"), "# Already\nbody", "fb").unwrap();
        assert_eq!(name, "X.md");
        assert_eq!(read(dir.path(), &name), "# Already\nbody\n");
    }

    #[test]
    fn title_without_text_is_a_heading_only() {
        let dir = tempfile::tempdir().unwrap();
        let name = save_shared(dir.path(), Some("Idea"), "  \n", "fb").unwrap();
        assert_eq!(read(dir.path(), &name), "# Idea\n");
    }

    #[test]
    fn derives_the_title_from_the_first_line() {
        let dir = tempfile::tempdir().unwrap();
        let name = save_shared(dir.path(), None, "\n## Shopping list\n- milk\n", "fb").unwrap();
        assert_eq!(name, "Shopping list.md");
        assert_eq!(read(dir.path(), &name), "## Shopping list\n- milk\n");
    }

    #[test]
    fn a_bare_url_is_named_after_its_host() {
        let dir = tempfile::tempdir().unwrap();
        let name = save_shared(dir.path(), None, "https://example.com/a/b?q=1", "fb").unwrap();
        assert_eq!(name, "example.com.md");
    }

    #[test]
    fn sanitizes_and_uniquifies_names() {
        let dir = tempfile::tempdir().unwrap();
        let first = save_shared(dir.path(), Some("a/b: c?  ..."), "t", "fb").unwrap();
        assert_eq!(first, "a b c.md");
        let second = save_shared(dir.path(), Some("a/b: c?"), "t", "fb").unwrap();
        assert_eq!(second, "a b c 2.md");
        let long = "x".repeat(200);
        let name = save_shared(dir.path(), Some(&long), "t", "fb").unwrap();
        assert_eq!(name.chars().count(), MAX_STEM_CHARS + 3);
    }

    #[test]
    fn falls_back_to_the_timestamp_title() {
        let dir = tempfile::tempdir().unwrap();
        let name = save_shared(dir.path(), None, "###\n", "Shared 2026-10-05 0930").unwrap();
        assert_eq!(name, "Shared 2026-10-05 0930.md");
        assert!(matches!(
            save_shared(dir.path(), None, "  \n", "fb"),
            Err(AppError::InvalidInput { .. })
        ));
        assert!(matches!(
            save_shared(dir.path(), Some("   "), "", "fb"),
            Err(AppError::InvalidInput { .. })
        ));
    }
}
