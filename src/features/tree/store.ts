import { create } from "zustand";

import { commands, events, type TreeNode } from "@/lib/bindings";
import { createDebouncer } from "@/lib/debounce";
import {
  baseName,
  ensureMarkdownExt,
  isWithin,
  joinPath,
  parentOf,
  remapPath,
  uniqueName,
} from "@/lib/paths";
import { errorMessage, unwrap } from "@/lib/result";
import { t } from "@/lib/i18n";

type Status = "idle" | "loading" | "ready" | "error";

interface TreeState {
  notebookId: string | null;
  nodes: TreeNode[];
  status: Status;
  error: string | null;
  expanded: Record<string, true>;
  selectedPath: string | null;

  load: (notebookId: string) => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => void;
  toggle: (dir: string) => void;
  /** Expands every ancestor so `path` is visible. */
  reveal: (path: string) => void;
  select: (path: string | null) => void;

  /** Creates `Untitled.md` (or a numbered variant) in `dir` and returns its path. */
  createNote: (dir: string, name?: string) => Promise<string>;
  createFolder: (dir: string, name: string) => Promise<string>;
  rename: (from: string, newName: string) => Promise<string>;
  move: (from: string, toDir: string) => Promise<string>;
  remove: (path: string) => Promise<void>;
}

/** Finds the node at `path`, if present. */
export function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.kind === "dir" && isWithin(path, node.path)) {
      const hit = findNode(node.children, path);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Names already used directly inside `dir`. */
export function childNames(nodes: TreeNode[], dir: string): string[] {
  const parent = dir ? findNode(nodes, dir) : undefined;
  const children = dir ? (parent?.children ?? []) : nodes;
  return children.map((c) => c.name);
}

export const useTreeStore = create<TreeState>((set, get) => ({
  notebookId: null,
  nodes: [],
  status: "idle",
  error: null,
  expanded: {},
  selectedPath: null,

  load: async (notebookId) => {
    set({
      notebookId,
      status: "loading",
      error: null,
      nodes: [],
      expanded: {},
      selectedPath: null,
    });
    await get().refresh();
  },

  refresh: async () => {
    const id = get().notebookId;
    if (!id) return;
    try {
      const nodes = await unwrap(commands.listTree(id));
      // Only accept the result if the notebook was not switched meanwhile.
      if (get().notebookId === id) set({ nodes, status: "ready", error: null });
    } catch (error) {
      if (get().notebookId === id) set({ status: "error", error: errorMessage(error) });
    }
  },

  clear: () => {
    set({
      notebookId: null,
      nodes: [],
      status: "idle",
      error: null,
      expanded: {},
      selectedPath: null,
    });
  },

  toggle: (dir) => {
    set((s) => {
      if (s.expanded[dir]) {
        const { [dir]: _closed, ...rest } = s.expanded;
        return { expanded: rest };
      }
      return { expanded: { ...s.expanded, [dir]: true } };
    });
  },

  reveal: (path) => {
    set((s) => {
      const expanded = { ...s.expanded };
      let dir = parentOf(path);
      while (dir) {
        expanded[dir] = true;
        dir = parentOf(dir);
      }
      return { expanded };
    });
  },

  select: (path) => {
    set({ selectedPath: path });
  },

  createNote: async (dir, name) => {
    const id = requireId(get().notebookId);
    const fileName = name
      ? ensureMarkdownExt(name.trim())
      : uniqueName(childNames(get().nodes, dir), "Untitled", ".md");
    const path = await unwrap(commands.createFile(id, joinPath(dir, fileName)));
    await get().refresh();
    get().reveal(path);
    set({ selectedPath: path });
    return path;
  },

  createFolder: async (dir, name) => {
    const id = requireId(get().notebookId);
    const path = await unwrap(commands.createDir(id, joinPath(dir, name.trim())));
    await get().refresh();
    get().reveal(path);
    set((s) => ({ expanded: { ...s.expanded, [path]: true } }));
    return path;
  },

  rename: async (from, newName) => {
    const id = requireId(get().notebookId);
    const node = findNode(get().nodes, from);
    const name = node?.kind === "file" ? ensureMarkdownExt(newName.trim()) : newName.trim();
    const to = await unwrap(commands.renameEntry(id, from, joinPath(parentOf(from), name)));
    afterMove(get, set, from, to);
    await get().refresh();
    return to;
  },

  move: async (from, toDir) => {
    const id = requireId(get().notebookId);
    const target = joinPath(toDir, baseName(from));
    if (target === from) return from;
    const to = await unwrap(commands.renameEntry(id, from, target));
    afterMove(get, set, from, to);
    await get().refresh();
    get().reveal(to);
    return to;
  },

  remove: async (path) => {
    const id = requireId(get().notebookId);
    await unwrap(commands.deleteEntry(id, path));
    set((s) => ({
      selectedPath: s.selectedPath && isWithin(s.selectedPath, path) ? null : s.selectedPath,
    }));
    await get().refresh();
  },
}));

function requireId(id: string | null): string {
  if (!id) throw new Error(t("tree.noNotebookOpen"));
  return id;
}

function afterMove(
  get: () => TreeState,
  set: (partial: Partial<TreeState>) => void,
  from: string,
  to: string,
) {
  const s = get();
  const expanded: Record<string, true> = {};
  for (const dir of Object.keys(s.expanded)) expanded[remapPath(dir, from, to)] = true;
  set({
    expanded,
    selectedPath: s.selectedPath ? remapPath(s.selectedPath, from, to) : null,
  });
}

const refreshDebouncer = createDebouncer(150);

/**
 * Subscribes to filesystem change events for the open notebook. Call once at startup;
 * returns an unsubscribe function.
 */
export async function startTreeSync(
  onPathsChanged: (paths: string[]) => void,
): Promise<() => void> {
  const unlisten = await events.notebookChanged.listen((event) => {
    const { notebookId, paths } = event.payload;
    if (notebookId !== useTreeStore.getState().notebookId) return;
    refreshDebouncer.schedule("tree", () => {
      void useTreeStore.getState().refresh();
    });
    onPathsChanged(paths);
  });
  return unlisten;
}
