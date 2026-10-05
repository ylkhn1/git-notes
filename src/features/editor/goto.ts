import { EditorView } from "@codemirror/view";

import { useEditorStore } from "./store";
import { activeEditorView } from "./view-ref";

let pending: { path: string; line: number } | null = null;

/** Puts the cursor on `line` (1-based) and scrolls it into view. */
export function revealLine(view: EditorView, line: number) {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: "center" }),
  });
  view.focus();
}

/**
 * Jumps to a line in `path`: immediately when that note is the active editor, otherwise
 * remembered until the editor mounts its state (see `takePendingGoTo`).
 */
export function goToLine(path: string, line: number) {
  const view = activeEditorView.get();
  const tab = useEditorStore.getState().tabs.find((t) => t.path === path);
  if (view && useEditorStore.getState().activePath === path && tab?.status === "ready") {
    revealLine(view, line);
    return;
  }
  pending = { path, line };
}

/** Consumes the pending jump for `path`, if any. */
export function takePendingGoTo(path: string): number | null {
  if (pending?.path !== path) return null;
  const { line } = pending;
  pending = null;
  return line;
}
