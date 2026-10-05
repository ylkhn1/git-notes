import { create } from "zustand";

const STORAGE_KEY = "gn.recent-files";
const MAX_RECENT = 20;

interface RecentState {
  byNotebook: Record<string, string[]>;
  touch: (notebookId: string, path: string) => void;
  forget: (notebookId: string, path: string) => void;
  rename: (notebookId: string, from: string, to: string) => void;
}

function load(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function persist(byNotebook: Record<string, string[]>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byNotebook));
  } catch {
    // Storage may be unavailable; recency is a convenience only.
  }
}

/** Recently opened notes per notebook, most recent first. A per-device convenience. */
export const useRecentStore = create<RecentState>((set) => ({
  byNotebook: load(),
  touch: (notebookId, path) =>
    set((s) => {
      const list = [path, ...(s.byNotebook[notebookId] ?? []).filter((p) => p !== path)].slice(
        0,
        MAX_RECENT,
      );
      const byNotebook = { ...s.byNotebook, [notebookId]: list };
      persist(byNotebook);
      return { byNotebook };
    }),
  forget: (notebookId, path) =>
    set((s) => {
      const list = (s.byNotebook[notebookId] ?? []).filter(
        (p) => p !== path && !p.startsWith(`${path}/`),
      );
      const byNotebook = { ...s.byNotebook, [notebookId]: list };
      persist(byNotebook);
      return { byNotebook };
    }),
  rename: (notebookId, from, to) =>
    set((s) => {
      const list = (s.byNotebook[notebookId] ?? []).map((p) =>
        p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p,
      );
      const byNotebook = { ...s.byNotebook, [notebookId]: list };
      persist(byNotebook);
      return { byNotebook };
    }),
}));

const EMPTY: string[] = [];

export function selectRecent(notebookId: string | null) {
  return (s: RecentState) => (notebookId ? (s.byNotebook[notebookId] ?? EMPTY) : EMPTY);
}
