import { create } from "zustand";

import { commands, type NoteLinks } from "@/lib/bindings";
import { createDebouncer } from "@/lib/debounce";
import { unwrap } from "@/lib/result";

interface LinksState {
  notebookId: string | null;
  /** Every note that contains wiki links; null until the first scan finishes. */
  index: NoteLinks[] | null;
  /** The backlinks list under the editor is expanded. */
  panelOpen: boolean;
  load: (notebookId: string) => Promise<void>;
  /** Files changed on disk: rescan soon. */
  markStale: () => void;
  reset: () => void;
  togglePanel: (open?: boolean) => void;
}

const rescan = createDebouncer(800);

/** The notebook's link index (from Rust) for backlinks and rename updates. */
export const useLinksStore = create<LinksState>((set, get) => ({
  notebookId: null,
  index: null,
  panelOpen: false,
  load: async (notebookId) => {
    if (get().notebookId !== notebookId) set({ notebookId, index: null });
    const index = await unwrap(commands.listNoteLinks(notebookId));
    if (get().notebookId === notebookId) set({ index });
  },
  markStale: () => {
    const id = get().notebookId;
    if (!id) return;
    rescan.schedule("links", () => {
      get()
        .load(id)
        .catch(() => undefined);
    });
  },
  reset: () => {
    rescan.cancel("links");
    set({ notebookId: null, index: null });
  },
  togglePanel: (open) => set((s) => ({ panelOpen: open ?? !s.panelOpen })),
}));
