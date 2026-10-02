import { create } from "zustand";

import { commands, events, type RepoStatus, type SyncReport, type SyncState } from "@/lib/bindings";
import { errorMessage, unwrap } from "@/lib/result";

import { useEditorStore } from "@/features/editor/store";

export const idleState: SyncState = { state: "idle" };

interface SyncStoreState {
  notebookId: string | null;
  status: RepoStatus | null;
  statusError: string | null;
  state: SyncState;
  lastReport: SyncReport | null;
  lastSyncedAt: number | null;

  /** Switches the store to a notebook (or none) and loads its status and sync state. */
  attach: (notebookId: string | null) => Promise<void>;
  refreshStatus: () => Promise<void>;
  /** Saves open tabs, then runs one full sync. Resolves to the report, or null if nothing ran. */
  syncNow: () => Promise<SyncReport | null>;
  initRepo: () => Promise<void>;
  setRemoteUrl: (url: string | null) => Promise<void>;
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  notebookId: null,
  status: null,
  statusError: null,
  state: idleState,
  lastReport: null,
  lastSyncedAt: null,

  attach: async (notebookId) => {
    set({
      notebookId,
      status: null,
      statusError: null,
      state: idleState,
      lastReport: null,
      lastSyncedAt: null,
    });
    if (!notebookId) return;
    try {
      const [status, state] = await Promise.all([
        unwrap(commands.getRepoStatus(notebookId)),
        unwrap(commands.getSyncState(notebookId)),
      ]);
      if (get().notebookId === notebookId) set({ status, state });
    } catch (error) {
      if (get().notebookId === notebookId) set({ statusError: errorMessage(error) });
    }
  },

  refreshStatus: async () => {
    const { notebookId } = get();
    if (!notebookId) return;
    try {
      const status = await unwrap(commands.getRepoStatus(notebookId));
      if (get().notebookId === notebookId) set({ status, statusError: null });
    } catch (error) {
      if (get().notebookId === notebookId) set({ statusError: errorMessage(error) });
    }
  },

  syncNow: async () => {
    const { notebookId, state } = get();
    if (!notebookId || state.state === "syncing") return null;
    await useEditorStore.getState().saveAll();
    set({ state: { state: "syncing" } });
    try {
      const report = await unwrap(commands.syncNow(notebookId));
      if (get().notebookId === notebookId) {
        set({ state: report.state, lastReport: report, lastSyncedAt: Date.now() });
      }
      return report;
    } catch (error) {
      if (get().notebookId === notebookId) {
        set({ state: { state: "error", data: errorMessage(error) } });
      }
      return null;
    } finally {
      void get().refreshStatus();
    }
  },

  initRepo: async () => {
    const { notebookId } = get();
    if (!notebookId) return;
    const status = await unwrap(commands.initRepo(notebookId));
    if (get().notebookId === notebookId) set({ status, statusError: null });
  },

  setRemoteUrl: async (url) => {
    const { notebookId } = get();
    if (!notebookId) return;
    const status = await unwrap(commands.setRemoteUrl(notebookId, url));
    if (get().notebookId === notebookId) set({ status, statusError: null, state: idleState });
  },
}));

/** Mirrors backend sync-state events into the store. Returns an unlisten function. */
export async function startSyncEvents(): Promise<() => void> {
  const unlisten = await events.syncStateChanged.listen((event) => {
    const { notebookId, state } = event.payload;
    const store = useSyncStore.getState();
    if (notebookId !== store.notebookId) return;
    useSyncStore.setState({ state });
    if (state.state !== "syncing") void store.refreshStatus();
  });
  return unlisten;
}
