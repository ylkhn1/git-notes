import type { EditorState } from "@codemirror/state";

/**
 * CodeMirror states per open file. Lives outside React so undo history and selection
 * survive tab switches; cleared when a tab closes or a notebook is closed.
 */
const cache = new Map<string, { state: EditorState; version: number }>();

export const editorStateCache = {
  get(path: string, version: number): EditorState | undefined {
    const entry = cache.get(path);
    return entry?.version === version ? entry.state : undefined;
  },
  set(path: string, version: number, state: EditorState) {
    cache.set(path, { state, version });
  },
  rename(from: string, to: string) {
    for (const key of Array.from(cache.keys())) {
      if (key === from || key.startsWith(`${from}/`)) {
        const entry = cache.get(key);
        cache.delete(key);
        if (entry) cache.set(to + key.slice(from.length), entry);
      }
    }
  },
  forget(path: string) {
    for (const key of Array.from(cache.keys())) {
      if (key === path || key.startsWith(`${path}/`)) cache.delete(key);
    }
  },
  clear() {
    cache.clear();
  },
};
