import { create } from "zustand";

import { activeEditorView } from "@/features/editor/view-ref";

/** Where a drag would land: the open note, or a folder of the tree (`""` = notebook root). */
export type DropTarget = { kind: "editor" } | { kind: "folder"; dir: string };

interface DropState {
  target: DropTarget | null;
  setTarget: (target: DropTarget | null) => void;
}

/** The current drop target, for highlighting (drags from the OS and inside the tree). */
export const useDropStore = create<DropState>((set) => ({
  target: null,
  setTarget: (target) => set((s) => (sameTarget(s.target, target) ? s : { target })),
}));

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "editor" || b.kind === "editor") return a.kind === b.kind;
  return a.dir === b.dir;
}

/**
 * The drop target under a point (CSS pixels). Elements opt in with `data-drop-editor`
 * (the editor), `data-tree-dir` (a tree row: its folder, or a file's parent) and
 * `data-drop-tree` (empty tree space = notebook root).
 */
export function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.closest("[data-drop-editor]") && activeEditorView.get()) return { kind: "editor" };
  const row = el.closest<HTMLElement>("[data-tree-dir]");
  if (row) return { kind: "folder", dir: row.dataset.treeDir ?? "" };
  if (el.closest("[data-drop-tree]")) return { kind: "folder", dir: "" };
  return null;
}

/** The document position under a point in the active editor, if any. */
export function editorPosAt(x: number, y: number): number | undefined {
  return activeEditorView.get()?.posAtCoords({ x, y }) ?? undefined;
}
