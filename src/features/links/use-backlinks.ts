import { useEffect, useMemo } from "react";

import type { NoteLinks } from "@/lib/bindings";
import { type Backlink, backlinksTo, notePaths } from "@/lib/wikilinks";

import { useTreeStore } from "@/features/tree/store";

import { useLinksStore } from "./store";

/** Notes that link to `path`, grouped by note. Recomputed when the index or tree changes. */
export function useBacklinks(path: string): Backlink[] | null {
  const index = useLinksStore((s) => s.index);
  const nodes = useTreeStore((s) => s.nodes);
  return useMemo(
    () => (index ? backlinksTo(path, index, notePaths(nodes)) : null),
    [index, nodes, path],
  );
}

/** The notebook's link and tag index, loading it when needed; null until loaded. */
export function useLinkIndex(notebookId: string | null): NoteLinks[] | null {
  const loadedFor = useLinksStore((s) => s.notebookId);
  const index = useLinksStore((s) => s.index);
  useEffect(() => {
    if (notebookId && loadedFor !== notebookId) {
      useLinksStore
        .getState()
        .load(notebookId)
        .catch(() => undefined);
    }
  }, [loadedFor, notebookId]);
  return loadedFor === notebookId ? index : null;
}
