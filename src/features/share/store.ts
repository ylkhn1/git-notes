import { create } from "zustand";

import { commands, type SharedContent } from "@/lib/bindings";
import { isAndroid } from "@/lib/platform";
import { errorMessage, unwrap } from "@/lib/result";

import { useEditorStore } from "@/features/editor/store";
import { useTreeStore } from "@/features/tree/store";

interface ShareState {
  /** Text another app shared with us, waiting for a notebook to be open. */
  pending: SharedContent | null;
  error: string | null;
  /** Asks the Android side for a new share (on start-up and when the app comes back). */
  poll: () => Promise<void>;
  /** Saves the pending text as a new note in `notebookId` and opens it. */
  saveInto: (notebookId: string) => Promise<void>;
  discard: () => void;
}

export const useShareStore = create<ShareState>((set, get) => ({
  pending: null,
  error: null,

  poll: async () => {
    if (!isAndroid) return;
    try {
      const shared = await unwrap(commands.takeSharedContent());
      if (shared) set({ pending: shared, error: null });
    } catch {
      // Nothing was shared, or the plugin is not there (desktop): nothing to do.
    }
  },

  saveInto: async (notebookId) => {
    const shared = get().pending;
    if (!shared) return;
    try {
      const path = await unwrap(commands.saveSharedNote(notebookId, shared.title, shared.text));
      set({ pending: null, error: null });
      const tree = useTreeStore.getState();
      await tree.refresh();
      tree.reveal(path);
      tree.select(path);
      await useEditorStore.getState().open(notebookId, path);
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  discard: () => {
    set({ pending: null, error: null });
  },
}));
