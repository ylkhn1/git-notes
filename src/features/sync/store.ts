import { create } from "zustand";

import {
  commands,
  events,
  type ConflictInfo,
  type ConflictResolution,
  type RepoStatus,
  type SyncPlan,
  type SyncReport,
  type SyncState,
  type SyncTrigger,
} from "@/lib/bindings";
import { errorMessage, unwrap } from "@/lib/result";

import { useEditorStore } from "@/features/editor/store";

export const idleState: SyncState = { state: "idle" };

interface SyncStoreState {
  notebookId: string | null;
  status: RepoStatus | null;
  statusError: string | null;
  state: SyncState;
  /** What the scheduler will do next (debounced sync, offline retry). */
  plan: SyncPlan | null;
  lastReport: SyncReport | null;
  lastSyncedAt: number | null;
  /** Conflict copies present in the notebook, whichever device created them. */
  conflicts: ConflictInfo[];
  /** Copies the user dismissed the banner for (this session); keyed by path. */
  dismissedConflicts: string[];

  /** Switches the store to a notebook (or none), loads its status and asks for a resume sync. */
  attach: (notebookId: string | null) => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshConflicts: () => Promise<void>;
  /** Saves open tabs, then runs one full sync. Resolves to the report, or null if nothing ran. */
  syncNow: () => Promise<SyncReport | null>;
  /** Background sync on focus/resume; the scheduler decides whether it is worth running. */
  requestSync: (trigger: SyncTrigger) => Promise<void>;
  resolveConflict: (copy: string, resolution: ConflictResolution) => Promise<void>;
  dismissConflicts: () => void;
  initRepo: () => Promise<void>;
  setRemoteUrl: (url: string | null) => Promise<void>;
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  notebookId: null,
  status: null,
  statusError: null,
  state: idleState,
  plan: null,
  lastReport: null,
  lastSyncedAt: null,
  conflicts: [],
  dismissedConflicts: [],

  attach: async (notebookId) => {
    set({
      notebookId,
      status: null,
      statusError: null,
      state: idleState,
      plan: null,
      lastReport: null,
      lastSyncedAt: null,
      conflicts: [],
      dismissedConflicts: [],
    });
    if (!notebookId) return;
    try {
      const [status, state, plan, conflicts] = await Promise.all([
        unwrap(commands.getRepoStatus(notebookId)),
        unwrap(commands.getSyncState(notebookId)),
        unwrap(commands.getSyncPlan(notebookId)),
        unwrap(commands.listConflicts(notebookId)),
      ]);
      if (get().notebookId !== notebookId) return;
      set({ status, state, plan, conflicts });
      if (status.isRepo && status.remoteUrl) await get().requestSync("focus");
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

  refreshConflicts: async () => {
    const { notebookId } = get();
    if (!notebookId) return;
    try {
      const conflicts = await unwrap(commands.listConflicts(notebookId));
      if (get().notebookId === notebookId) set({ conflicts });
    } catch {
      // The tree refresh will surface a broken notebook; keep the last known list.
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
        set({
          state: report.state,
          lastReport: report,
          ...(isSuccess(report.state) ? { lastSyncedAt: Date.now() } : {}),
        });
      }
      return report;
    } catch (error) {
      if (get().notebookId === notebookId) {
        set({ state: { state: "error", data: errorMessage(error) } });
      }
      return null;
    } finally {
      void get().refreshStatus();
      void get().refreshConflicts();
    }
  },

  requestSync: async (trigger) => {
    const { notebookId, status } = get();
    if (!notebookId || !status?.isRepo || !status.remoteUrl) return;
    await useEditorStore.getState().saveAll();
    try {
      await unwrap(commands.requestSync(notebookId, trigger));
    } catch {
      // Not fatal: the next edit or a manual sync tries again.
    }
  },

  resolveConflict: async (copy, resolution) => {
    const { notebookId } = get();
    if (!notebookId) return;
    await unwrap(commands.resolveConflict(notebookId, copy, resolution));
    set((s) => ({ conflicts: s.conflicts.filter((c) => c.copy !== copy) }));
    void get().refreshConflicts();
  },

  dismissConflicts: () => {
    set((s) => ({ dismissedConflicts: s.conflicts.map((c) => c.copy) }));
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

/** A run that reached the remote (possibly with conflict copies). */
function isSuccess(state: SyncState): boolean {
  return state.state === "upToDate" || state.state === "conflict";
}

/**
 * Conflict copies the banner should show: everything not dismissed in this session.
 * Returns a new array; memoize the result rather than passing this as a store selector.
 */
export function selectVisibleConflicts(
  s: Pick<SyncStoreState, "conflicts" | "dismissedConflicts">,
): ConflictInfo[] {
  return s.conflicts.filter((c) => !s.dismissedConflicts.includes(c.copy));
}

/** Mirrors backend sync-state and plan events into the store. Returns an unlisten function. */
export async function startSyncEvents(): Promise<() => void> {
  const unlistenState = await events.syncStateChanged.listen((event) => {
    const { notebookId, state } = event.payload;
    const store = useSyncStore.getState();
    if (notebookId !== store.notebookId) return;
    const finished = state.state !== "syncing" && store.state.state === "syncing";
    useSyncStore.setState(
      finished && isSuccess(state) ? { state, lastSyncedAt: Date.now() } : { state },
    );
    if (state.state !== "syncing" && state.state !== "pending") {
      void store.refreshStatus();
      if (finished) void store.refreshConflicts();
    }
  });
  const unlistenPlan = await events.syncPlanChanged.listen((event) => {
    const { notebookId, plan } = event.payload;
    if (notebookId !== useSyncStore.getState().notebookId) return;
    useSyncStore.setState({ plan });
  });
  return () => {
    unlistenState();
    unlistenPlan();
  };
}
