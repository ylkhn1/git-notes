/** Helpers for notebook-relative paths (`a/b/c.md`, forward slashes, no leading slash). */

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** "notes/Daily log.md" → "Daily log" */
export function displayTitle(path: string): string {
  return baseName(path).replace(/\.(md|markdown)$/i, "");
}

/** Adds `.md` unless the user typed an extension already. */
export function ensureMarkdownExt(name: string): string {
  return /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : `${name}.md`;
}

/**
 * Returns `base.ext`, or `base 2.ext`, `base 3.ext`, … — the first name not in `taken`.
 * Comparison is case-insensitive because macOS/Windows file systems usually are.
 */
export function uniqueName(taken: Iterable<string>, base: string, ext: string): string {
  const lower = new Set(Array.from(taken, (n) => n.toLowerCase()));
  const candidate = (n: number) => (n === 1 ? `${base}${ext}` : `${base} ${String(n)}${ext}`);
  let n = 1;
  while (lower.has(candidate(n).toLowerCase())) n += 1;
  return candidate(n);
}

/** True when `path` is `dir` itself or lives somewhere below it. */
export function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** Rewrites `path` after `from` was renamed to `to` (both files or directories). */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return path;
}
