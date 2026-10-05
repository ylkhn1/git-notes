import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { findHeadingLine } from "@/lib/wikilinks";

import { useEditorStore } from "./store";
import { activeEditorView } from "./view-ref";

type Target = { line: number } | { heading: string };

let pending: { path: string; target: Target } | null = null;

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

function lineOf(target: Target, doc: Text): number | null {
  return "line" in target ? target.line : findHeadingLine(doc.toString(), target.heading);
}

function goTo(path: string, target: Target) {
  const view = activeEditorView.get();
  const tab = useEditorStore.getState().tabs.find((t) => t.path === path);
  if (view && useEditorStore.getState().activePath === path && tab?.status === "ready") {
    const line = lineOf(target, view.state.doc);
    if (line !== null) revealLine(view, line);
    return;
  }
  pending = { path, target };
}

/**
 * Jumps to a line in `path`: immediately when that note is the active editor, otherwise
 * remembered until the editor mounts its state (see `takePendingGoTo`).
 */
export function goToLine(path: string, line: number) {
  goTo(path, { line });
}

/** Like {@link goToLine}, for the heading with this text (`[[Note#Heading]]`). */
export function goToHeading(path: string, heading: string) {
  goTo(path, { heading });
}

/** Consumes the pending jump for `path`, if any, as a line number in `doc`. */
export function takePendingGoTo(path: string, doc: Text): number | null {
  if (pending?.path !== path) return null;
  const { target } = pending;
  pending = null;
  return lineOf(target, doc);
}
