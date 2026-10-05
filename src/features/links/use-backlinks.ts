import { useMemo } from "react";

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
