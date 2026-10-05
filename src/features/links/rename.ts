import { commands, type NoteLinks } from "@/lib/bindings";
import { remapPath } from "@/lib/paths";
import { unwrap } from "@/lib/result";
import { notePaths, planLinkRewrites } from "@/lib/wikilinks";

import { useEditorStore } from "@/features/editor/store";
import { useTreeStore } from "@/features/tree/store";

import { useLinksStore } from "./store";

/**
 * Runs a rename or move (`op` returns the new path) and then rewrites `[[links]]` in other
 * notes so they keep pointing at the same files. Open notes are saved first so the rewrite
 * works on what the user sees. A failed rewrite never undoes the move.
 */
export async function moveKeepingLinks(
  notebookId: string,
  from: string,
  op: () => Promise<string>,
): Promise<string> {
  await useEditorStore.getState().saveAll();
  const before = notePaths(useTreeStore.getState().nodes);
  let index: NoteLinks[] | null = null;
  try {
    index = await unwrap(commands.listNoteLinks(notebookId));
  } catch (error) {
    console.warn("links: could not scan before the move", error);
  }
  const to = await op();
  if (index && to !== from) {
    const after = notePaths(useTreeStore.getState().nodes);
    const rewrites = planLinkRewrites(index, before, after, (p) => remapPath(p, from, to));
    if (rewrites.length > 0) {
      try {
        await unwrap(commands.rewriteNoteLinks(notebookId, rewrites));
      } catch (error) {
        console.warn("links: could not update links after the move", error);
      }
    }
  }
  useLinksStore.getState().markStale();
  return to;
}
