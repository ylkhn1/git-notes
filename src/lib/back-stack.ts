import { useEffect } from "react";

import { isMobile } from "@/lib/platform";

/**
 * Android back-button support for in-app overlays (drawer, sheets, dialogs).
 *
 * Tauri's Android activity forwards BACK to the WebView while `history.canGoBack()`, so every
 * open overlay pushes a history entry; `popstate` then closes the most recent overlay. When an
 * overlay closes by other means, its entry is popped silently to keep history consistent.
 */
interface Entry {
  id: number;
  close: () => void;
}

const stack: Entry[] = [];
let nextId = 1;
let silentPops = 0;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (silentPops > 0) {
      silentPops -= 1;
      return;
    }
    stack.pop()?.close();
  });
}

/** Registers an open overlay; returns a function to call when it closes through the UI. */
export function pushOverlay(close: () => void): () => void {
  const entry: Entry = { id: nextId++, close };
  stack.push(entry);
  window.history.pushState({ gnOverlay: entry.id }, "");
  return () => {
    const index = stack.indexOf(entry);
    if (index === -1) return; // already popped by the back button
    stack.splice(index, 1);
    const state = window.history.state as { gnOverlay?: number } | null;
    if (state?.gnOverlay === entry.id) {
      silentPops += 1;
      window.history.back();
    }
  };
}

/** Hook form: while `open` is true the overlay can be dismissed with the back button. */
export function useBackClose(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open || !isMobile) return;
    return pushOverlay(close);
    // `close` identity changes every render; the stored callback only needs to exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
