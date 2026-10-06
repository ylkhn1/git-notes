import type { NoteLinks } from "@/lib/bindings";
import { displayTitle } from "@/lib/paths";
import { normalizeTarget, resolveWikiTarget } from "@/lib/wikilinks";

export type GraphNodeKind = "note" | "missing" | "tag";

export interface GraphNode {
  /** Note path, `missing:<target>` or `tag:<tag>`. */
  id: string;
  label: string;
  kind: GraphNodeKind;
  /** Number of edges. */
  degree: number;
}

export interface GraphData {
  nodes: GraphNode[];
  /** Undirected edges as node indexes, without duplicates or self loops. */
  edges: [number, number][];
}

export interface GraphOptions {
  /** Add a node per tag, linked to its notes. */
  tags: boolean;
  /** Keep notes without any edge. */
  orphans: boolean;
  /** Only the neighbourhood of this note… */
  focus: string | null;
  /** …up to this many hops. */
  depth: number;
}

/** Notes, wiki links (resolved like the editor resolves them) and optionally tags as a graph. */
export function buildGraph(
  notes: readonly string[],
  index: readonly NoteLinks[],
  options: GraphOptions,
): GraphData {
  const ids = new Map<string, GraphNode>();
  const add = (id: string, label: string, kind: GraphNodeKind) => {
    if (!ids.has(id)) ids.set(id, { id, label, kind, degree: 0 });
  };
  for (const path of notes) add(path, displayTitle(path), "note");

  const edgeKeys = new Set<string>();
  const pairs: [string, string][] = [];
  const connect = (a: string, b: string) => {
    if (a === b) return;
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    pairs.push([a, b]);
  };

  // Resolution scans every note; links repeat a lot, so remember answers per folder.
  const resolved = new Map<string, string | null>();
  const resolve = (target: string, from: string) => {
    const key = `${from.slice(0, from.lastIndexOf("/") + 1)}\u0000${target}`;
    if (!resolved.has(key)) resolved.set(key, resolveWikiTarget(target, notes, from));
    return resolved.get(key) ?? null;
  };

  for (const note of index) {
    if (!ids.has(note.path)) continue;
    for (const link of note.links) {
      if (!link.target) continue;
      const to = resolve(link.target, note.path);
      if (to) {
        connect(note.path, to);
      } else {
        const id = `missing:${normalizeTarget(link.target)}`;
        add(id, link.target, "missing");
        connect(note.path, id);
      }
    }
    if (options.tags) {
      for (const tag of note.tags) {
        const id = `tag:${tag.toLowerCase()}`;
        add(id, `#${tag}`, "tag");
        connect(note.path, id);
      }
    }
  }

  let keep: Set<string> | null = null;
  if (options.focus && ids.has(options.focus)) {
    const adjacent = new Map<string, string[]>();
    const link = (a: string, b: string) => {
      const list = adjacent.get(a);
      if (list) list.push(b);
      else adjacent.set(a, [b]);
    };
    for (const [a, b] of pairs) {
      link(a, b);
      link(b, a);
    }
    keep = new Set([options.focus]);
    let frontier = [options.focus];
    for (let hop = 0; hop < options.depth; hop++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const other of adjacent.get(id) ?? []) {
          if (!keep.has(other)) {
            keep.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
  }

  const kept = keep ? pairs.filter(([a, b]) => keep.has(a) && keep.has(b)) : pairs;
  for (const [a, b] of kept) {
    const na = ids.get(a);
    const nb = ids.get(b);
    if (na) na.degree += 1;
    if (nb) nb.degree += 1;
  }
  const nodes = [...ids.values()].filter(
    (n) =>
      (!keep || keep.has(n.id)) &&
      (n.degree > 0 || (n.kind === "note" && (options.orphans || n.id === options.focus))),
  );
  const position = new Map(nodes.map((n, i) => [n.id, i]));
  const edges: [number, number][] = [];
  for (const [a, b] of kept) {
    const i = position.get(a);
    const j = position.get(b);
    if (i !== undefined && j !== undefined) edges.push([i, j]);
  }
  return { nodes, edges };
}
