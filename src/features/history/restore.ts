import { commands } from "@/lib/bindings";
import { isMarkdown } from "@/lib/paths";
import { unwrap } from "@/lib/result";

import { useEditorStore } from "@/features/editor/store";
import { activeEditorView } from "@/features/editor/view-ref";
import { findNode, useTreeStore } from "@/features/tree/store";

export interface RestoreRequest {
  notebookId: string;
  commitId: string;
  /** The file's path in that commit. */
  path: string;
  /** Read the commit's first parent (where a file deleted by the commit still exists). */
  before: boolean;
  /** Where to write it; the current path of a renamed note. Defaults to `path`. */
  target?: string;
}

/** Whether restoring would overwrite a file that is not open in the editor. */
export function overwritesClosedFile({ path, target }: RestoreRequest): boolean {
  const dest = target ?? path;
  const editor = useEditorStore.getState();
  if (editor.activePath === dest && activeEditorView.get()) return false;
  return findNode(useTreeStore.getState().nodes, dest) !== undefined;
}

/**
 * Brings back an old version of a file.
 *
 * The note open in the editor is restored by replacing the editor text, so the change is
 * autosaved like any edit and Ctrl+Z undoes it. Anything else (closed or deleted files,
 * attachments) is written by Rust; a deleted note is then opened.
 */
export async function restoreVersion(request: RestoreRequest): Promise<string> {
  const { notebookId, commitId, path, before } = request;
  const target = request.target ?? path;
  const editor = useEditorStore.getState();
  const view = activeEditorView.get();
  const tab = editor.tabs.find((tab) => tab.path === target);
  if (view && tab?.status === "ready" && editor.activePath === target) {
    const version = await unwrap(commands.getFileVersion(notebookId, path, commitId, before));
    if (version.text !== null) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: version.text },
        userEvent: "revert",
      });
      view.focus();
      return target;
    }
  }
  const written = await unwrap(
    commands.restoreFile(notebookId, commitId, path, before, request.target ?? null),
  );
  await useTreeStore.getState().refresh();
  if (tab) {
    await editor.reloadFromDisk(written);
  } else if (isMarkdown(written)) {
    useTreeStore.getState().reveal(written);
    await editor.open(notebookId, written);
  }
  return written;
}
