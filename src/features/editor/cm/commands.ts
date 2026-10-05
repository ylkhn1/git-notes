/**
 * Markdown editing commands shared by keyboard shortcuts and the mobile formatting toolbar.
 * Each command works on the main selection and returns true when it changed something.
 */
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorSelection, type Line } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

import { t } from "@/lib/i18n";

/** Wraps the selection with `marker` (or unwraps when already wrapped). */
export function toggleInline(state: EditorState, marker: string): TransactionSpec | null {
  const range = state.selection.main;
  const len = marker.length;
  const before = state.sliceDoc(Math.max(0, range.from - len), range.from);
  const after = state.sliceDoc(range.to, range.to + len);
  if (before === marker && after === marker) {
    return {
      changes: [
        { from: range.from - len, to: range.from },
        { from: range.to, to: range.to + len },
      ],
      selection: EditorSelection.range(range.from - len, range.to - len),
    };
  }
  const selected = state.sliceDoc(range.from, range.to);
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= 2 * len) {
    return {
      changes: {
        from: range.from,
        to: range.to,
        insert: selected.slice(len, selected.length - len),
      },
      selection: EditorSelection.range(range.from, range.to - 2 * len),
    };
  }
  return {
    changes: [
      { from: range.from, insert: marker },
      { from: range.to, insert: marker },
    ],
    selection: EditorSelection.range(range.from + len, range.to + len),
  };
}

const LINE_PREFIX = /^(\s*)((?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|>\s?|#{1,6}\s+)?/;

function linesOf(state: EditorState): Line[] {
  const { from, to } = state.selection.main;
  const lines: Line[] = [];
  for (let pos = from; ;) {
    const line = state.doc.lineAt(pos);
    lines.push(line);
    if (line.to >= to) break;
    pos = line.to + 1;
  }
  return lines;
}

/**
 * Replaces the block prefix of every selected line. `prefix(line)` returns the new prefix
 * (without indentation); it receives the current prefix so toggles can be implemented.
 */
function rewritePrefixes(
  state: EditorState,
  prefix: (current: string, index: number) => string,
): TransactionSpec {
  const changes: { from: number; to: number; insert: string }[] = [];
  linesOf(state).forEach((line, index) => {
    const match = LINE_PREFIX.exec(line.text);
    const indent = match?.[1] ?? "";
    const current = match?.[2] ?? "";
    const next = prefix(current, index);
    if (next !== current) {
      changes.push({
        from: line.from + indent.length,
        to: line.from + indent.length + current.length,
        insert: next,
      });
    }
  });
  return { changes };
}

export const toggleBulletList = (state: EditorState) =>
  rewritePrefixes(state, (current) => (/^[-*+]\s+$/.test(current) ? "" : "- "));

export const toggleOrderedList = (state: EditorState) =>
  rewritePrefixes(state, (current, index) =>
    /^\d+[.)]\s+$/.test(current) ? "" : `${String(index + 1)}. `,
  );

export const toggleTask = (state: EditorState) =>
  rewritePrefixes(state, (current) => {
    if (/^[-*+]\s+\[[ xX]\]\s+$/.test(current)) return "- ";
    return "- [ ] ";
  });

export const toggleQuote = (state: EditorState) =>
  rewritePrefixes(state, (current) => (/^>\s?$/.test(current) ? "" : "> "));

/** Cycles heading level: none → H1 → H2 → H3 → none. */
export const cycleHeading = (state: EditorState) =>
  rewritePrefixes(state, (current) => {
    const level = /^(#{1,6})\s+$/.exec(current)?.[1]?.length ?? 0;
    if (level >= 3) return "";
    return `${"#".repeat(level + 1)} `;
  });

export function insertLink(state: EditorState): TransactionSpec {
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  const isUrl = /^https?:\/\/\S+$/.test(selected);
  const text = isUrl || !selected ? t("editor.linkText") : selected;
  const url = isUrl ? selected : "https://";
  const insert = `[${text}](${url})`;
  const urlStart = range.from + text.length + 3;
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: isUrl
      ? EditorSelection.range(range.from + 1, range.from + 1 + text.length)
      : EditorSelection.range(urlStart, urlStart + url.length),
  };
}

const run =
  (make: (state: EditorState) => TransactionSpec | null): Command =>
  (view: EditorView) => {
    const spec = make(view.state);
    if (!spec) return false;
    view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input.format" });
    return true;
  };

export const commands = {
  bold: run((s) => toggleInline(s, "**")),
  italic: run((s) => toggleInline(s, "*")),
  strikethrough: run((s) => toggleInline(s, "~~")),
  code: run((s) => toggleInline(s, "`")),
  heading: run(cycleHeading),
  bulletList: run(toggleBulletList),
  orderedList: run(toggleOrderedList),
  task: run(toggleTask),
  quote: run(toggleQuote),
  link: run(insertLink),
};
