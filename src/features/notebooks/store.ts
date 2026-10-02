import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

import { commands, type NotebookInfo } from "@/lib/bindings";
import { errorMessage, unwrap } from "@/lib/result";

import { useEditorStore } from "@/features/editor/store";
import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { useTreeStore } from "@/features/tree/store";

type Status = "idle" | "loading" | "ready" | "error";

interface NotebooksState {
  notebooks: NotebookInfo[];
  current: NotebookInfo | null;
  status: Status;
  error: string | null;
  defaultDir: string;
  /** Loads the list and reopens the last used notebook. */
  load: () => Promise<void>;
  select: (id: string) => Promise<void>;
  createNew: (name: string, parentDir?: string) => Promise<NotebookInfo>;
  /** Clones a git repository into the notebooks folder and opens it. */
  clone: (url: string, name: string | null) => Promise<NotebookInfo>;
  /** Shows the system folder picker and registers the chosen folder. */
  openFolder: () => Promise<NotebookInfo | null>;
  forget: (id: string) => Promise<void>;
  /** Returns to the notebook list without forgetting anything. */
  closeCurrent: () => Promise<void>;
}

export const useNotebooksStore = create<NotebooksState>((set, get) => ({
  notebooks: [],
  current: null,
  status: "idle",
  error: null,
  defaultDir: "",

  load: async () => {
    set({ status: "loading", error: null });
    try {
      const [notebooks, defaultDir] = await Promise.all([
        unwrap(commands.listNotebooks()),
        unwrap(commands.defaultNotebooksDir()),
      ]);
      set({ notebooks, defaultDir, status: "ready" });
      const lastId = useSettingsStore.getState().settings.lastNotebookId;
      if (lastId && notebooks.some((n) => n.id === lastId)) {
        await get().select(lastId);
      }
    } catch (error) {
      set({ status: "error", error: errorMessage(error) });
    }
  },

  select: async (id) => {
    const notebook = get().notebooks.find((n) => n.id === id);
    if (!notebook) return;
    const previous = get().current;
    if (previous && previous.id !== id) {
      await useEditorStore.getState().closeAll();
      void commands.unwatchNotebook(previous.id);
    }
    set({ current: notebook });
    void useSettingsStore.getState().update({ lastNotebookId: id });
    void useSyncStore.getState().attach(id);
    await useTreeStore.getState().load(id);
    await commands.watchNotebook(id);
  },

  createNew: async (name, parentDir) => {
    const info = await unwrap(commands.createNotebook(name, parentDir ?? null));
    set((s) => ({
      notebooks: s.notebooks.some((n) => n.id === info.id) ? s.notebooks : [...s.notebooks, info],
    }));
    await get().select(info.id);
    return info;
  },

  clone: async (url, name) => {
    const info = await unwrap(commands.cloneNotebook(url, name));
    set((s) => ({
      notebooks: s.notebooks.some((n) => n.id === info.id) ? s.notebooks : [...s.notebooks, info],
    }));
    await get().select(info.id);
    return info;
  },

  openFolder: async () => {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Open notebook folder",
    });
    if (typeof picked !== "string") return null;
    const info = await unwrap(commands.openNotebook(picked));
    set((s) => ({
      notebooks: s.notebooks.some((n) => n.id === info.id) ? s.notebooks : [...s.notebooks, info],
    }));
    await get().select(info.id);
    return info;
  },

  forget: async (id) => {
    if (get().current?.id === id) {
      await get().closeCurrent();
    }
    await unwrap(commands.forgetNotebook(id));
    set((s) => ({ notebooks: s.notebooks.filter((n) => n.id !== id) }));
  },

  closeCurrent: async () => {
    const current = get().current;
    if (!current) return;
    await useEditorStore.getState().closeAll();
    void commands.unwatchNotebook(current.id);
    useTreeStore.getState().clear();
    void useSyncStore.getState().attach(null);
    set({ current: null });
    void useSettingsStore.getState().update({ lastNotebookId: null });
  },
}));
