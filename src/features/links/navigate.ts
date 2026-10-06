import { resolveRelativePath } from "@/lib/asset-url";
import { commands } from "@/lib/bindings";
import { baseName, parentOf } from "@/lib/paths";
import { errorMessage, unwrap } from "@/lib/result";
import { notePaths, resolveWikiTarget, type WikiParts } from "@/lib/wikilinks";

import { isImagePath, isTextNotePath } from "@/features/editor/attachments";
import { goToHeading } from "@/features/editor/goto";
import { showImage } from "@/features/editor/lightbox-store";
import { useEditorStore } from "@/features/editor/store";
import { notify } from "@/features/shell/notice";
import { findNode, useTreeStore } from "@/features/tree/store";
import { validateName } from "@/features/tree/validation";

/**
 * Opens the note a wiki link points to. A link to a note that does not exist yet creates
 * it (at the notebook root, or at the folder path the link spells out), like Obsidian.
 */
export async function openWikiLink(fromPath: string, parts: WikiParts): Promise<void> {
  const notebookId = useEditorStore.getState().notebookId;
  if (!notebookId) return;
  if (!parts.target) {
    if (parts.heading) goToHeading(fromPath, parts.heading);
    return;
  }
  const notes = notePaths(useTreeStore.getState().nodes);
  let path = resolveWikiTarget(parts.target, notes, fromPath);
  if (!path) {
    const target = parts.target.replace(/\\/g, "/").replace(/^\/+/, "");
    const name = baseName(target);
    if (validateName(name) !== null) return;
    const dir = target.includes("/") ? parentOf(target) : "";
    try {
      path = await useTreeStore.getState().createNote(dir, name);
    } catch (error) {
      console.warn("links: could not create the linked note", error);
      return;
    }
  }
  if (parts.heading) goToHeading(path, parts.heading);
  await useEditorStore.getState().open(notebookId, path);
}

/**
 * Opens a notebook file the way its type asks for: notes in the editor, images in the
 * lightbox, other attachments with the system app.
 */
export async function openNotebookFile(notebookId: string, path: string): Promise<void> {
  if (isTextNotePath(path)) {
    await useEditorStore.getState().open(notebookId, path);
  } else if (isImagePath(path)) {
    showImage(notebookId, path);
  } else {
    try {
      await unwrap(commands.openNotebookFile(notebookId, path));
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
}

/**
 * Opens a Markdown link target (`[text](href)`, or an image source): web and mail links in
 * the browser, notebook files (relative to `fromPath`) with {@link openNotebookFile}.
 */
export async function openHref(fromPath: string, href: string): Promise<void> {
  const notebookId = useEditorStore.getState().notebookId;
  if (!notebookId) return;
  if (/^(https?:|mailto:)/i.test(href)) {
    try {
      await unwrap(commands.openExternalUrl(href));
    } catch (error) {
      notify(errorMessage(error), "error");
    }
    return;
  }
  const path = resolveRelativePath(fromPath, href);
  if (!path || !findNode(useTreeStore.getState().nodes, path)) return;
  await openNotebookFile(notebookId, path);
}
