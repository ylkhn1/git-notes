import { isAndroid } from "@/lib/platform";
import { parentOf } from "@/lib/paths";

const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

/**
 * URL served by the Rust `notebook://` protocol for a file inside a notebook.
 * Tauri exposes custom schemes as `scheme://localhost/...` on Linux/macOS and as
 * `http://scheme.localhost/...` on Windows and Android.
 */
export function notebookAssetUrl(notebookId: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const base = isWindows || isAndroid ? "http://notebook.localhost" : "notebook://localhost";
  return `${base}/${notebookId}/${encoded}`;
}

/**
 * Resolves a Markdown image reference relative to the note that contains it.
 * Returns null for anything that is not a plain relative path (http(s), data:, absolute).
 */
export function resolveRelativePath(notePath: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#"))
    return null;
  const clean = decodeURIComponent(href.split(/[?#]/)[0] ?? "");
  const parts = parentOf(notePath).split("/").filter(Boolean);
  for (const segment of clean.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length ? parts.join("/") : null;
}
