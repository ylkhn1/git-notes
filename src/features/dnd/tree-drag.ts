import type { PointerEvent as ReactPointerEvent } from "react";

import type { TreeNode } from "@/lib/bindings";
import { baseName, isMarkdown, isWithin, parentOf } from "@/lib/paths";
import { errorMessage } from "@/lib/result";
import { linkTargetFor, notePaths, withoutExtension } from "@/lib/wikilinks";

import { isImagePath, relativeHref } from "@/features/editor/attachments";
import { useEditorStore } from "@/features/editor/store";
import { activeEditorView } from "@/features/editor/view-ref";
import { moveKeepingLinks } from "@/features/links/rename";
import { notify } from "@/features/shell/notice";
import { useTreeStore } from "@/features/tree/store";

import { type DropTarget, editorPosAt, targetAt, useDropStore } from "./store";

/** Pointer travel (px) before a press on a row becomes a drag. */
const THRESHOLD = 5;

/**
 * Drag of a tree entry, with pointer events (HTML5 drag and drop is unreliable in Tauri
 * webviews). Dropped on a folder (or empty tree space) the entry moves there and links to
 * it are rewritten; dropped on the open note a link to it is inserted at the drop point.
 */
export function beginTreeDrag(event: ReactPointerEvent, node: TreeNode, notebookId: string) {
  if (event.button !== 0 || event.pointerType === "touch") return;
  // Without this, moving over the editor with the button held selects text there.
  event.preventDefault();
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.focus({ preventScroll: true });
  }
  const startX = event.clientX;
  const startY = event.clientY;
  let ghost: HTMLDivElement | null = null;
  let target: DropTarget | null = null;

  const valid = (candidate: DropTarget | null): DropTarget | null => {
    if (!candidate) return null;
    if (candidate.kind === "editor") {
      const active = useEditorStore.getState().activePath;
      return node.kind === "file" && active && active !== node.path ? candidate : null;
    }
    if (candidate.dir === parentOf(node.path)) return null;
    if (node.kind === "dir" && isWithin(candidate.dir, node.path)) return null;
    return candidate;
  };

  const onMove = (e: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
      ghost = document.createElement("div");
      ghost.className =
        "pointer-events-none fixed z-50 rounded-md border border-line bg-surface px-2 py-1 text-sm text-text shadow-lg";
      ghost.textContent = node.kind === "dir" ? node.name : withoutExtension(node.name);
      document.body.appendChild(ghost);
      document.body.style.cursor = "grabbing";
    }
    ghost.style.left = `${String(e.clientX + 12)}px`;
    ghost.style.top = `${String(e.clientY + 8)}px`;
    target = valid(targetAt(e.clientX, e.clientY));
    useDropStore.getState().setTarget(target);
  };

  const finish = (e: PointerEvent | null) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey, true);
    useDropStore.getState().setTarget(null);
    document.body.style.cursor = "";
    if (!ghost) return;
    ghost.remove();
    // The press ended a drag, not a click: swallow the click that follows.
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => {
      window.removeEventListener("click", swallow, true);
    }, 0);
    if (e && target) {
      drop(node, notebookId, target, e.clientX, e.clientY).catch((error: unknown) => {
        notify(errorMessage(error), "error");
      });
    }
  };
  const onUp = (e: PointerEvent) => {
    finish(e);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    target = null;
    finish(null);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
}

function swallow(e: Event) {
  e.stopPropagation();
  e.preventDefault();
}

async function drop(node: TreeNode, notebookId: string, target: DropTarget, x: number, y: number) {
  if (target.kind === "folder") {
    const from = node.path;
    const to = await moveKeepingLinks(notebookId, from, () =>
      useTreeStore.getState().move(from, target.dir),
    );
    useEditorStore.getState().renamed(from, to);
    return;
  }
  const view = activeEditorView.get();
  const active = useEditorStore.getState().activePath;
  if (!view || !active) return;
  const at = editorPosAt(x, y) ?? view.state.selection.main.head;
  const insert = isMarkdown(node.path)
    ? `[[${linkTargetFor(node.path, notePaths(useTreeStore.getState().nodes), active)}]]`
    : `${isImagePath(node.path) ? "!" : ""}[${baseName(node.path)}](${relativeHref(active, node.path)})`;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    scrollIntoView: true,
    userEvent: "input.drop",
  });
  view.focus();
}
