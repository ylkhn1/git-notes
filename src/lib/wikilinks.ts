/**
 * Wiki links (`[[Note]]`, `[[folder/Note#Heading|alias]]`): parsing of the inner text and
 * resolution of a target to a note path. This is the only place that decides which file a
 * link points to; the Rust side (`notebook/links.rs`) only finds and rewrites link text.
 *
 * Resolution follows Obsidian: a target is first tried relative to the linking note's
 * folder, then as a path from the notebook root, then as a file name (or path suffix)
 * anywhere. When several notes match, the one in the linking note's folder wins, then the
 * shallowest path, then alphabetical order. Comparison ignores case and the `.md` extension.
 */

import type { LinkRewrite, NoteLinks, TreeNode } from "@/lib/bindings";

import { baseName, displayTitle, isMarkdown, parentOf } from "./paths";

export interface WikiParts {
  /** Note part as written, trimmed; empty for `[[#Heading]]` (the current note). */
  target: string;
  heading: string | null;
  alias: string | null;
}

/** Splits the text between `[[` and `]]`. */
export function parseWikiInner(inner: string): WikiParts {
  const pipe = inner.indexOf("|");
  const page = pipe === -1 ? inner : inner.slice(0, pipe);
  const alias = pipe === -1 ? null : inner.slice(pipe + 1).trim() || null;
  const hash = page.indexOf("#");
  const target = (hash === -1 ? page : page.slice(0, hash)).trim();
  const heading = hash === -1 ? null : page.slice(hash + 1).trim() || null;
  return { target, heading, alias };
}

/** Comparison form; mirrors `normalize_target` in `src-tauri/src/notebook/links.rs`. */
export function normalizeTarget(target: string): string {
  let t = target.trim().replace(/\\/g, "/");
  while (t.startsWith("./")) t = t.slice(2);
  t = t.replace(/^\/+/, "").toLowerCase();
  return t.replace(/\.(markdown|md)$/, "");
}

/** `folder/Note.md` → `folder/Note` */
export function withoutExtension(path: string): string {
  return path.replace(/\.(md|markdown)$/i, "");
}

/** Every Markdown note in the tree, depth-first. */
export function notePaths(nodes: readonly TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "dir") notePaths(node.children, out);
    else if (isMarkdown(node.path)) out.push(node.path);
  }
  return out;
}

function depth(path: string): number {
  return path.split("/").length;
}

/** The note `target` points to when written in `from`, or null when no note matches. */
export function resolveWikiTarget(
  target: string,
  notes: readonly string[],
  from: string | null,
): string | null {
  const wanted = normalizeTarget(target);
  if (wanted === "") return null;
  const home = from === null ? null : parentOf(from);
  if (home) {
    const local = normalizeTarget(`${home}/${wanted}`);
    const sibling = notes.find((p) => normalizeTarget(p) === local);
    if (sibling) return sibling;
  }
  const exact = notes.find((p) => normalizeTarget(p) === wanted);
  if (exact) return exact;
  const candidates = wanted.includes("/")
    ? notes.filter((p) => normalizeTarget(p).endsWith(`/${wanted}`))
    : notes.filter((p) => normalizeTarget(baseName(p)) === wanted);
  if (candidates.length <= 1) return candidates[0] ?? null;
  return (
    [...candidates].sort((a, b) => {
      const sameA = parentOf(a) === home ? 0 : 1;
      const sameB = parentOf(b) === home ? 0 : 1;
      if (sameA !== sameB) return sameA - sameB;
      const d = depth(a) - depth(b);
      if (d !== 0) return d;
      return a.localeCompare(b);
    })[0] ?? null
  );
}

/** The shortest link text that resolves to `path` from `from`: the name, else the path. */
export function linkTargetFor(path: string, notes: readonly string[], from: string | null): string {
  const name = displayTitle(path);
  return resolveWikiTarget(name, notes, from) === path ? name : withoutExtension(path);
}

export interface Backlink {
  path: string;
  lineNo: number;
  line: string;
}

/** Links from other notes that resolve to `path`, in index order. */
export function backlinksTo(
  path: string,
  index: readonly NoteLinks[],
  notes: readonly string[],
): Backlink[] {
  const out: Backlink[] = [];
  for (const note of index) {
    if (note.path === path) continue;
    for (const link of note.links) {
      if (link.target && resolveWikiTarget(link.target, notes, note.path) === path) {
        out.push({ path: note.path, lineNo: link.lineNo, line: link.line });
      }
    }
  }
  return out;
}

/**
 * Link edits needed after files moved. `index` and `before` describe the notebook before
 * the move, `after` the notes afterwards, and `moved` maps an old path to its new one
 * (identity for untouched files). A link is rewritten when it would otherwise point
 * somewhere else (or nowhere) after the move; the new text is the shortest unambiguous one.
 */
export function planLinkRewrites(
  index: readonly NoteLinks[],
  before: readonly string[],
  after: readonly string[],
  moved: (path: string) => string,
): LinkRewrite[] {
  const rewrites: LinkRewrite[] = [];
  for (const note of index) {
    const newPath = moved(note.path);
    const replacements = new Map<string, string>();
    for (const link of note.links) {
      if (!link.target) continue;
      const key = normalizeTarget(link.target);
      if (replacements.has(key)) continue;
      const old = resolveWikiTarget(link.target, before, note.path);
      if (old === null) continue;
      const expected = moved(old);
      if (resolveWikiTarget(link.target, after, newPath) === expected) continue;
      replacements.set(key, linkTargetFor(expected, after, newPath));
    }
    if (replacements.size > 0) {
      rewrites.push({
        path: newPath,
        replacements: Array.from(replacements, ([from, to]) => ({ from, to })),
      });
    }
  }
  return rewrites;
}

/** Line (1-based) of the first heading whose text equals `heading`, ignoring case. */
export function findHeadingLine(text: string, heading: string): number | null {
  const wanted = heading.trim().toLowerCase();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(lines[i] ?? "");
    if (match?.[1]?.trim().toLowerCase() === wanted) return i + 1;
  }
  return null;
}
