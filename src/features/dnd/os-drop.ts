import { getCurrentWebview } from "@tauri-apps/api/webview";

import { commands } from "@/lib/bindings";
import { t } from "@/lib/i18n";
import { isMarkdown } from "@/lib/paths";
import { errorMessage, unwrap } from "@/lib/result";

import { attachPaths } from "@/features/editor/attachments";
import { useEditorStore } from "@/features/editor/store";
import { activeEditorView } from "@/features/editor/view-ref";
import { useNotebooksStore } from "@/features/notebooks/store";
import { notify } from "@/features/shell/notice";
import { useTreeStore } from "@/features/tree/store";

import { type DropTarget, editorPosAt, targetAt, useDropStore } from "./store";

/**
 * Files dragged in from the file manager (they arrive through Tauri, not DOM events).
 * Over the note they become attachments at the drop point; over the tree they are copied
 * into the folder under the cursor (the root elsewhere).
 */
export async function startOsDrop(): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    const drop = useDropStore.getState();
    if (payload.type === "leave") {
      drop.setTarget(null);
      return;
    }
    // Physical pixels relative to the webview → CSS pixels.
    const scale = window.devicePixelRatio || 1;
    const x = payload.position.x / scale;
    const y = payload.position.y / scale;
    const target = targetAt(x, y);
    if (payload.type !== "drop") {
      drop.setTarget(target ?? { kind: "folder", dir: "" });
      return;
    }
    drop.setTarget(null);
    dropPaths(payload.paths, target, x, y).catch((error: unknown) => {
      notify(errorMessage(error), "error");
    });
  });
}

async function dropPaths(paths: string[], target: DropTarget | null, x: number, y: number) {
  const notebookId = useNotebooksStore.getState().current?.id;
  if (!notebookId || paths.length === 0) return;
  const editor = useEditorStore.getState();
  const view = activeEditorView.get();
  if (target?.kind === "editor" && view && editor.activePath) {
    await attachPaths(notebookId, editor.activePath, paths, view, editorPosAt(x, y));
    return;
  }
  const dir = target?.kind === "folder" ? target.dir : "";
  const added = await unwrap(commands.importFiles(notebookId, dir, paths));
  const tree = useTreeStore.getState();
  await tree.refresh();
  const first = added[0];
  if (!first) return;
  tree.reveal(first);
  if (added.length === 1 && isMarkdown(first)) {
    await editor.open(notebookId, first);
  } else {
    notify(t("tree.filesAdded", { count: added.length }));
  }
}
