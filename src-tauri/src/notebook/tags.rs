//! Tags: `#tag` and `#nested/tag` in the text, plus `tags:` in YAML frontmatter.
//!
//! Follows Obsidian: a tag starts with `#` at the start of a line or after whitespace and
//! continues with letters, digits, `_`, `-` and `/`; a tag made only of digits (`#123`) is
//! not a tag. Tags inside code blocks and inline code are ignored. The same rules are
//! implemented for the editor in `src/lib/tags.ts`.

use super::links::{Fences, code_span_end};

/// Every tag in `text`, without `#`, in order of first appearance. Tags that differ only in
/// case count as one; the first spelling wins.
pub fn extract(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |tag: &str| {
        let tag = tag.trim().trim_start_matches('#').trim_end_matches('/');
        if is_valid(tag) && !out.iter().any(|t| t.to_lowercase() == tag.to_lowercase()) {
            out.push(tag.to_owned());
        }
    };
    let (front, body) = split_frontmatter(text);
    if let Some(front) = front {
        for tag in frontmatter_tags(front) {
            push(&tag);
        }
    }
    let mut fences = Fences::default();
    for line in body.lines() {
        if fences.is_code(line) {
            continue;
        }
        for tag in inline_tags(line) {
            push(tag);
        }
    }
    out
}

/// Whether `tag` is `filter` or nested below it (`work` matches `work/plans`), ignoring case.
pub fn matches(tag: &str, filter: &str) -> bool {
    let tag = tag.to_lowercase();
    let filter = filter
        .trim_start_matches('#')
        .trim_end_matches('/')
        .to_lowercase();
    !filter.is_empty()
        && (tag == filter
            || tag
                .strip_prefix(&filter)
                .is_some_and(|rest| rest.starts_with('/')))
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

fn is_valid(tag: &str) -> bool {
    !tag.is_empty()
        && !tag.starts_with('/')
        && tag.chars().all(is_tag_char)
        && tag.chars().any(|c| !c.is_ascii_digit() && c != '/')
}

/// Splits off a leading `---` … `---` (or `...`) block.
fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return (None, text);
    };
    let mut offset = 0;
    for chunk in rest.split_inclusive('\n') {
        let line = chunk.trim_end();
        if line == "---" || line == "..." {
            return (Some(&rest[..offset]), &rest[offset + chunk.len()..]);
        }
        offset += chunk.len();
    }
    (None, text)
}

/// Values of `tags:` / `tag:` in frontmatter: `[a, b]`, `a, b`, `a b` or a `- a` list.
fn frontmatter_tags(front: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_list = false;
    for line in front.lines() {
        let trimmed = line.trim();
        if in_list {
            if let Some(item) = trimmed.strip_prefix("- ") {
                out.push(unquote(item).to_owned());
                continue;
            }
            if trimmed.is_empty() {
                continue;
            }
            in_list = false;
        }
        if line.starts_with([' ', '\t']) {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_lowercase();
        if key != "tags" && key != "tag" {
            continue;
        }
        let value = value.trim();
        if value.is_empty() {
            in_list = true;
            continue;
        }
        let value = value
            .strip_prefix('[')
            .and_then(|v| v.strip_suffix(']'))
            .unwrap_or(value);
        out.extend(
            value
                .split([',', ' '])
                .map(unquote)
                .filter(|v| !v.is_empty())
                .map(str::to_owned),
        );
    }
    out
}

fn unquote(value: &str) -> &str {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .unwrap_or(value)
        .trim()
}

/// `#tags` of one line outside inline code spans.
fn inline_tags(line: &str) -> Vec<&str> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'`' => i = code_span_end(bytes, i),
            b'#' if i == 0 || line[..i].ends_with(char::is_whitespace) => {
                let start = i + 1;
                let len: usize = line[start..]
                    .chars()
                    .take_while(|&c| is_tag_char(c))
                    .map(char::len_utf8)
                    .sum();
                let tag = line[start..start + len].trim_end_matches('/');
                if is_valid(tag) {
                    out.push(tag);
                }
                i = start + len;
            }
            _ => i += 1,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_inline_tags_outside_code() {
        let text = "# Heading\n\
            Text #work and #проект/план, #123 is not, a#b neither.\n\
            `#code` and #ok-tag/\n\
            ```\n#fenced\n```\n\
            ## Not #a-heading-tag? yes it is\n";
        assert_eq!(
            extract(text),
            vec!["work", "проект/план", "ok-tag", "a-heading-tag"]
        );
    }

    #[test]
    fn reads_frontmatter_forms_and_dedupes_case_insensitively() {
        let inline = "---\ntitle: X\ntags: [Alpha, \"beta\"]\n---\nbody #alpha #gamma\n";
        assert_eq!(extract(inline), vec!["Alpha", "beta", "gamma"]);

        let list = "---\ntags:\n  - one\n  - '#two'\ncreated: today\n---\n";
        assert_eq!(extract(list), vec!["one", "two"]);

        let plain = "---\ntag: solo, duo\n---\n";
        assert_eq!(extract(plain), vec!["solo", "duo"]);

        // Not frontmatter when it is not at the very start.
        assert_eq!(extract("\n---\ntags: x\n---\n"), Vec::<String>::new());
    }

    #[test]
    fn nested_filters_match_children() {
        assert!(matches("Work", "work"));
        assert!(matches("work/plans", "#work"));
        assert!(!matches("workshop", "work"));
        assert!(!matches("work", "work/plans"));
        assert!(!matches("work", ""));
    }
}
