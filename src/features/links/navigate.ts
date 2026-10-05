import { resolveRelativePath } from "@/lib/asset-url";
import { baseName, isMarkdown, parentOf } from "@/lib/paths";
import { notePaths, resolveWikiTarget, type WikiParts } from "@/lib/wikilinks";

import { goToHeading } from "@/features/editor/goto";
import { useEditorStore } from "@/features/editor/store";
import { useTreeStore } from "@/features/tree/store";
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

/** Opens a Markdown link to another note (`[text](../Other.md)`), relative to `fromPath`. */
export async function openNoteHref(fromPath: string, href: string): Promise<void> {
  const notebookId = useEditorStore.getState().notebookId;
  const path = resolveRelativePath(fromPath, href);
  if (!notebookId || !path || !isMarkdown(path)) return;
  if (!notePaths(useTreeStore.getState().nodes).includes(path)) return;
  await useEditorStore.getState().open(notebookId, path);
}
