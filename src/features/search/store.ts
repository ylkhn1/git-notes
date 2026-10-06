import { create } from "zustand";

import { commands, type SearchResults } from "@/lib/bindings";
import { createDebouncer } from "@/lib/debounce";
import { errorMessage, unwrap } from "@/lib/result";

import { useUiStore } from "@/features/shell/ui-store";

/** Notes listed at most; the panel says when there are more. */
export const SEARCH_LIMIT = 200;

interface SearchState {
  notebookId: string | null;
  query: string;
  /** Results and the query they belong to (results lag the query while typing). */
  results: SearchResults | null;
  forQuery: string | null;
  error: string | null;
  /** Bumped to ask the search input to take focus. */
  focusToken: number;
  setNotebook: (notebookId: string | null) => void;
  setQuery: (query: string) => void;
  /** Files changed on disk: run the current query again soon. */
  refreshSoon: () => void;
}

const debounce = createDebouncer(200);

async function run(notebookId: string, query: string) {
  const trimmed = query.trim();
  const state = useSearchStore.getState;
  if (!trimmed) {
    useSearchStore.setState({ results: null, forQuery: null, error: null });
    return;
  }
  try {
    const results = await unwrap(commands.searchNotes(notebookId, trimmed, SEARCH_LIMIT));
    if (state().notebookId === notebookId && state().query.trim() === trimmed) {
      useSearchStore.setState({ results, forQuery: trimmed, error: null });
    }
  } catch (error) {
    if (state().notebookId === notebookId && state().query.trim() === trimmed) {
      useSearchStore.setState({ results: null, forQuery: trimmed, error: errorMessage(error) });
    }
  }
}

/** The sidebar search: query, debounced Rust search and its results. */
export const useSearchStore = create<SearchState>((set, get) => ({
  notebookId: null,
  query: "",
  results: null,
  forQuery: null,
  error: null,
  focusToken: 0,
  setNotebook: (notebookId) => {
    const previous = get().notebookId;
    if (previous === notebookId) return;
    if (previous === null) {
      // First notebook: keep a query set before the panel mounted (a clicked tag).
      set({ notebookId });
      get().refreshSoon();
      return;
    }
    debounce.cancel("search");
    set({ notebookId, query: "", results: null, forQuery: null, error: null });
  },
  setQuery: (query) => {
    set({ query });
    const id = get().notebookId;
    if (!id) return;
    debounce.schedule("search", () => {
      void run(id, get().query);
    });
  },
  refreshSoon: () => {
    const { notebookId, query } = get();
    if (!notebookId || !query.trim()) return;
    debounce.schedule("search", () => {
      void run(notebookId, get().query);
    });
  },
}));

/** Opens the search panel with `query` (e.g. `tag:work`) and runs it. */
export function searchFor(query: string) {
  useUiStore.getState().showSidebar("search");
  useSearchStore.getState().setQuery(query);
}

/** Opens the search panel and focuses its input. */
export function focusSearch() {
  useUiStore.getState().showSidebar("search");
  useSearchStore.setState((s) => ({ focusToken: s.focusToken + 1 }));
}

const NO_TERMS: readonly string[] = [];

/** Terms to highlight in the editor: those of the shown results while the panel is open. */
export function useHighlightTerms(): readonly string[] {
  const view = useUiStore((s) => s.sidebarView);
  const results = useSearchStore((s) => s.results);
  return view === "search" && results ? results.terms : NO_TERMS;
}
