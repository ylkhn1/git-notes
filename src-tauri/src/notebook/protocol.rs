//! Serving notebook files to the webview over the custom `notebook://` URI scheme.
//!
//! URL shape: `notebook://localhost/<notebook-id>/<relative/path.png>` (on Windows and
//! Android Tauri maps it to `http://notebook.localhost/...`). Only the pure parsing and
//! content-type helpers live here; the Tauri handler in `lib.rs` is a thin wrapper.

use std::path::Path;

use crate::error::{AppError, AppResult};

/// Splits the URL path into `(notebook_id, relative_path)`, percent-decoded.
pub fn parse_request_path(path: &str) -> AppResult<(String, String)> {
    let trimmed = path.trim_start_matches('/');
    let (id, rest) = trimmed
        .split_once('/')
        .ok_or_else(|| AppError::invalid_input("expected /<notebook-id>/<path>"))?;
    if id.is_empty() || rest.is_empty() {
        return Err(AppError::invalid_input("expected /<notebook-id>/<path>"));
    }
    let rel = percent_decode(rest)?;
    Ok((id.to_owned(), super::paths::normalize(&rel)?))
}

/// Decodes `%XX` escapes as UTF-8. No external crate needed for this small job.
pub fn percent_decode(input: &str) -> AppResult<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok())
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| AppError::invalid_input("malformed percent-encoding"))?;
            out.push(hex);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| AppError::invalid_input("path is not valid UTF-8"))
}

/// Content type by extension; only formats the editor can display are served.
pub fn content_type(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_decodes() {
        let (id, rel) = parse_request_path("/abc123/assets/my%20image.png").unwrap();
        assert_eq!(id, "abc123");
        assert_eq!(rel, "assets/my image.png");
        assert_eq!(
            percent_decode("%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82").unwrap(),
            "привет"
        );
    }

    #[test]
    fn rejects_bad_paths() {
        assert!(parse_request_path("/onlyid").is_err());
        assert!(parse_request_path("//x.png").is_err());
        assert!(parse_request_path("/abc/../etc/passwd").is_err());
        assert!(parse_request_path("/abc/%zz.png").is_err());
    }

    #[test]
    fn content_types() {
        assert_eq!(content_type(Path::new("a.PNG")), Some("image/png"));
        assert_eq!(content_type(Path::new("a.jpeg")), Some("image/jpeg"));
        assert_eq!(content_type(Path::new("notes.md")), None);
        assert_eq!(content_type(Path::new("noext")), None);
    }
}
