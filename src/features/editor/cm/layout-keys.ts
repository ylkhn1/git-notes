import { Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";

import { latinKeyEvent } from "@/lib/keyboard-layout";

/**
 * Runs the editor keymap for `event` as if typed on a Latin layout (`Ctrl+И` → `Mod-b`).
 * True when a binding handled it; the original event is then cancelled.
 */
export function runLatinKeymap(view: EditorView, event: KeyboardEvent): boolean {
  const latin = latinKeyEvent(event);
  if (!latin || !runScopeHandlers(view, latin, "editor")) return false;
  event.preventDefault();
  return true;
}

/** Editor shortcuts that keep working when a non-Latin keyboard layout is active. */
export const layoutIndependentKeys = Prec.highest(
  EditorView.domEventHandlers({ keydown: (event, view) => runLatinKeymap(view, event) }),
);
