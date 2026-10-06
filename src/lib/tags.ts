/**
 * Tags (`#tag`, `#nested/tag`, frontmatter `tags:`). Rust (`notebook/tags.rs`) extracts the
 * tags of every note into the link index; this module has the shared rules for the editor
 * and builds the nested tag tree for the tags panel.
 */

import type { NoteLinks } from "@/lib/bindings";

const TAG_CHAR = /^[\p{L}\p{N}_\-/]$/u;

export function isTagChar(ch: string): boolean {
  return TAG_CHAR.test(ch);
}

/** A tag body (without `#`): tag chars only, not only digits, not starting with `/`. */
export function isValidTag(tag: string): boolean {
  if (tag === "" || tag.startsWith("/")) return false;
  const chars = Array.from(tag);
  return chars.every(isTagChar) && chars.some((c) => !/[0-9/]/.test(c));
}

/** `tag` is `filter` or nested below it, ignoring case (`work` matches `work/plans`). */
export function tagMatches(tag: string, filter: string): boolean {
  const t = tag.toLowerCase();
  const f = filter.replace(/^#/, "").replace(/\/+$/, "").toLowerCase();
  return f !== "" && (t === f || t.startsWith(`${f}/`));
}

export interface TagNode {
  /** Last segment as first written (`plans` of `work/plans`). */
  name: string;
  /** Full tag as first written. */
  tag: string;
  /** Notes with this tag or a tag nested below it. */
  count: number;
  children: TagNode[];
}

interface Building {
  name: string;
  tag: string;
  notes: Set<string>;
  children: Map<string, Building>;
}

/** Nested tag tree with note counts, alphabetical at every level. */
export function buildTagTree(index: readonly NoteLinks[]): TagNode[] {
  const roots = new Map<string, Building>();
  for (const note of index) {
    for (const tag of note.tags) {
      const parts = tag.split("/").filter(Boolean);
      let level = roots;
      let prefix = "";
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part;
        const key = part.toLowerCase();
        let node = level.get(key);
        if (!node) {
          node = { name: part, tag: prefix, notes: new Set(), children: new Map() };
          level.set(key, node);
        }
        node.notes.add(note.path);
        level = node.children;
      }
    }
  }
  const finish = (level: Map<string, Building>): TagNode[] =>
    [...level.values()]
      .map((b) => ({ name: b.name, tag: b.tag, count: b.notes.size, children: finish(b.children) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return finish(roots);
}

/** Every distinct tag (first spelling), most used first, for completion. */
export function allTags(index: readonly NoteLinks[]): string[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const note of index) {
    for (const tag of note.tags) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((e) => e.tag);
}
