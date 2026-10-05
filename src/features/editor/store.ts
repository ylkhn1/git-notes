import { create } from "zustand";

import { commands } from "@/lib/bindings";
import { createDebouncer } from "@/lib/debounce";
import { displayTitle, isWithin, remapPath } from "@/lib/paths";
import { errorMessage, unwrap } from "@/lib/result";

import { editorStateCache } from "./cm/state-cache";
import { useRecentStore } from "./recent";

export const AUTOSAVE_DELAY_MS = 800;

export interface Tab {
  path: string;
  title: string;
  /** Current editor text; the source of truth for saving. */
  text: string;
  /** Text as last loaded from or written to disk. */
  savedText: string;
  modifiedMs: number;
  status: "loading" | "ready" | "error";
  error: string | null;
  saving: boolean;
  saveError: string | null;
  /** Bumped whenever the text was replaced from disk, so the editor view resets. */
  reloadVersion: number;
  /** The file changed on disk while this tab had unsaved edits. */
  externallyChanged: boolean;
}

interface EditorState {
  notebookId: string | null;
  tabs: Tab[];
  activePath: string | null;

  open: (notebookId: string, path: string) => Promise<void>;
  activate: (path: string) => void;
  close: (path: string) => Promise<void>;
  closeAll: () => Promise<void>;

  setText: (path: string, text: string) => void;
  save: (path: string) => Promise<void>;
  saveAll: () => Promise<void>;

  /** Files changed on disk (from the watcher): reload clean tabs, flag dirty ones. */
  externalChanges: (paths: string[]) => Promise<void>;
  /** Discards local edits and re-reads the file. */
  reloadFromDisk: (path: string) => Promise<void>;
  renamed: (from: string, to: string) => void;
  removed: (path: string) => void;
}

const autosave = createDebouncer(AUTOSAVE_DELAY_MS);

export const isDirty = (tab: Tab) => tab.text !== tab.savedText;

function patchTab(
  tabs: Tab[],
  path: string,
  patch: Partial<Tab> | ((tab: Tab) => Partial<Tab>),
): Tab[] {
  return tabs.map((tab) => {
    if (tab.path !== path) return tab;
    return { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) };
  });
}

export const useEditorStore = create<EditorState>((set, get) => ({
  notebookId: null,
  tabs: [],
  activePath: null,

  open: async (notebookId, path) => {
    if (get().notebookId !== notebookId) {
      await get().closeAll();
      set({ notebookId });
    }
    useRecentStore.getState().touch(notebookId, path);
    if (get().tabs.some((t) => t.path === path)) {
      set({ activePath: path });
      return;
    }
    const tab: Tab = {
      path,
      title: displayTitle(path),
      text: "",
      savedText: "",
      modifiedMs: 0,
      status: "loading",
      error: null,
      saving: false,
      saveError: null,
      reloadVersion: 0,
      externallyChanged: false,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activePath: path }));
    try {
      const file = await unwrap(commands.readFile(notebookId, path));
      set((s) => ({
        tabs: patchTab(s.tabs, path, {
          text: file.text,
          savedText: file.text,
          modifiedMs: file.modifiedMs,
          status: "ready",
        }),
      }));
    } catch (error) {
      set((s) => ({
        tabs: patchTab(s.tabs, path, { status: "error", error: errorMessage(error) }),
      }));
    }
  },

  activate: (path) => {
    if (get().tabs.some((t) => t.path === path)) set({ activePath: path });
  },

  close: async (path) => {
    autosave.cancel(path);
    const tab = get().tabs.find((t) => t.path === path);
    if (tab?.status === "ready" && isDirty(tab)) {
      await get().save(path);
    }
    editorStateCache.forget(path);
    set((s) => {
      const index = s.tabs.findIndex((t) => t.path === path);
      const tabs = s.tabs.filter((t) => t.path !== path);
      let activePath = s.activePath;
      if (activePath === path) {
        const neighbour = tabs[Math.min(index, tabs.length - 1)];
        activePath = neighbour ? neighbour.path : null;
      }
      return { tabs, activePath };
    });
  },

  closeAll: async () => {
    await get().saveAll();
    editorStateCache.clear();
    set({ tabs: [], activePath: null });
  },

  setText: (path, text) => {
    set((s) => ({ tabs: patchTab(s.tabs, path, { text, saveError: null }) }));
    autosave.schedule(path, () => {
      void get().save(path);
    });
  },

  save: async (path) => {
    autosave.cancel(path);
    const { notebookId } = get();
    const tab = get().tabs.find((t) => t.path === path);
    if (!notebookId || tab?.status !== "ready" || !isDirty(tab) || tab.saving) return;
    const text = tab.text;
    set((s) => ({ tabs: patchTab(s.tabs, path, { saving: true }) }));
    try {
      const result = await unwrap(commands.writeFile(notebookId, path, text));
      set((s) => ({
        tabs: patchTab(s.tabs, path, {
          savedText: text,
          modifiedMs: result.modifiedMs,
          saving: false,
          saveError: null,
          externallyChanged: false,
        }),
      }));
      // Edits that arrived while writing are saved by the next debounce tick.
      const latest = get().tabs.find((t) => t.path === path);
      if (latest && isDirty(latest)) {
        autosave.schedule(path, () => {
          void get().save(path);
        });
      }
    } catch (error) {
      set((s) => ({
        tabs: patchTab(s.tabs, path, { saving: false, saveError: errorMessage(error) }),
      }));
    }
  },

  saveAll: async () => {
    autosave.flushAll();
    await Promise.all(
      get()
        .tabs.filter(isDirty)
        .map((t) => get().save(t.path)),
    );
  },

  externalChanges: async (paths) => {
    const { notebookId, tabs } = get();
    if (!notebookId) return;
    const affected = tabs.filter(
      (t) =>
        t.status === "ready" && paths.some((p) => p === "" || p === t.path || isWithin(t.path, p)),
    );
    for (const tab of affected) {
      if (tab.saving) continue;
      try {
        const file = await unwrap(commands.readFile(notebookId, tab.path));
        if (file.modifiedMs === tab.modifiedMs && file.text === tab.savedText) continue;
        if (isDirty(tab)) {
          set((s) => ({ tabs: patchTab(s.tabs, tab.path, { externallyChanged: true }) }));
        } else {
          set((s) => ({
            tabs: patchTab(s.tabs, tab.path, (current) => ({
              text: file.text,
              savedText: file.text,
              modifiedMs: file.modifiedMs,
              reloadVersion: current.reloadVersion + 1,
            })),
          }));
        }
      } catch {
        // Deleted or unreadable: leave the tab as is; the tree refresh shows the truth.
      }
    }
  },

  reloadFromDisk: async (path) => {
    const { notebookId } = get();
    if (!notebookId) return;
    autosave.cancel(path);
    try {
      const file = await unwrap(commands.readFile(notebookId, path));
      set((s) => ({
        tabs: patchTab(s.tabs, path, (current) => ({
          text: file.text,
          savedText: file.text,
          modifiedMs: file.modifiedMs,
          externallyChanged: false,
          saveError: null,
          reloadVersion: current.reloadVersion + 1,
        })),
      }));
    } catch (error) {
      set((s) => ({ tabs: patchTab(s.tabs, path, { saveError: errorMessage(error) }) }));
    }
  },

  renamed: (from, to) => {
    editorStateCache.rename(from, to);
    const notebookId = get().notebookId;
    if (notebookId) useRecentStore.getState().rename(notebookId, from, to);
    set((s) => ({
      tabs: s.tabs.map((t) => {
        const path = remapPath(t.path, from, to);
        return path === t.path ? t : { ...t, path, title: displayTitle(path) };
      }),
      activePath: s.activePath ? remapPath(s.activePath, from, to) : null,
    }));
  },

  removed: (path) => {
    const notebookId = get().notebookId;
    if (notebookId) useRecentStore.getState().forget(notebookId, path);
    for (const tab of get().tabs) {
      if (isWithin(tab.path, path)) autosave.cancel(tab.path);
    }
    editorStateCache.forget(path);
    set((s) => {
      const tabs = s.tabs.filter((t) => !isWithin(t.path, path));
      const activePath =
        s.activePath && isWithin(s.activePath, path)
          ? (tabs[tabs.length - 1]?.path ?? null)
          : s.activePath;
      return { tabs, activePath };
    });
  },
}));

/** Active tab selector. */
export const selectActiveTab = (s: EditorState) =>
  s.tabs.find((t) => t.path === s.activePath) ?? null;
