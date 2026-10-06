/**
 * Changes against a git version, shown inside the note.
 *
 * The editor gets a baseline text (by default the note as committed in `HEAD`) through
 * [`setChangeBaseline`]. Every line that differs gets a coloured bar in the left margin:
 * green for added, accent for modified, a red notch where lines were removed. With
 * [`setInlineChanges`] the removed lines are also shown as struck-through blocks above the
 * place they came from, each with a button that reverts that change.
 */
import {
  type EditorState,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { t } from "@/lib/i18n";
import { diffLines, type LineHunk, toLines } from "@/lib/line-diff";

/** New baseline text, or null to hide all markers. */
export const setChangeBaseline = StateEffect.define<string | null>();
/** Shows or hides the removed lines inline. */
export const setInlineChanges = StateEffect.define<boolean>();

interface ChangesState {
  base: string[] | null;
  inline: boolean;
  hunks: LineHunk[];
  decorations: DecorationSet;
}

const empty: ChangesState = {
  base: null,
  inline: false,
  hunks: [],
  decorations: Decoration.none,
};

export const changesField = StateField.define<ChangesState>({
  create: () => empty,
  update(value, tr) {
    let { base, inline } = value;
    let touched = tr.docChanged;
    for (const effect of tr.effects) {
      if (effect.is(setChangeBaseline)) {
        base = effect.value === null ? null : toLines(effect.value);
        touched = true;
      } else if (effect.is(setInlineChanges)) {
        inline = effect.value;
        touched = true;
      }
    }
    if (!touched) return value;
    if (!base) return { ...empty, inline };
    const hunks = diffLines(base, docLines(tr.state.doc));
    return { base, inline, hunks, decorations: build(tr.state, base, hunks, inline) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Changed regions of the current document against the baseline. */
export function changeHunks(state: EditorState): readonly LineHunk[] {
  return state.field(changesField, false)?.hunks ?? [];
}

function docLines(doc: Text): string[] {
  const lines: string[] = [];
  for (const line of doc.iterLines()) lines.push(line);
  return lines;
}

const added = Decoration.line({ class: "cm-git-added" });
const modified = Decoration.line({ class: "cm-git-modified" });
const deletedAbove = Decoration.line({ class: "cm-git-deleted-above" });
const deletedBelow = Decoration.line({ class: "cm-git-deleted-below" });

function build(
  state: EditorState,
  base: string[],
  hunks: LineHunk[],
  inline: boolean,
): DecorationSet {
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  for (const hunk of hunks) {
    const removed = hunk.oldTo - hunk.oldFrom;
    const inserted = hunk.newTo - hunk.newFrom;
    const lineDeco = removed === 0 ? added : modified;
    for (let i = hunk.newFrom; i < hunk.newTo; i++) {
      ranges.push(lineDeco.range(doc.line(i + 1).from));
    }
    if (inserted === 0) {
      // Pure removal: mark the line after the gap, or the last line at the end of the note.
      if (hunk.newFrom < doc.lines) {
        ranges.push(deletedAbove.range(doc.line(hunk.newFrom + 1).from));
      } else {
        ranges.push(deletedBelow.range(doc.line(doc.lines).from));
      }
    }
    if (inline) {
      const widget = new RemovedLinesWidget(base.slice(hunk.oldFrom, hunk.oldTo), hunk);
      if (hunk.newFrom < doc.lines) {
        const at = doc.line(hunk.newFrom + 1).from;
        ranges.push(Decoration.widget({ widget, block: true, side: -1 }).range(at));
      } else {
        ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(doc.length));
      }
    }
  }
  return Decoration.set(ranges, true);
}

/** Puts the baseline lines of `hunk` back in place of the current ones. */
export function revertHunk(view: EditorView, hunk: LineHunk) {
  const value = view.state.field(changesField, false);
  if (!value?.base) return;
  const doc = view.state.doc;
  const old = value.base.slice(hunk.oldFrom, hunk.oldTo);
  let from: number;
  let to: number;
  let insert: string;
  if (hunk.newTo > hunk.newFrom) {
    from = doc.line(hunk.newFrom + 1).from;
    to = doc.line(hunk.newTo).to;
    insert = old.join("\n");
    if (old.length === 0) {
      // Removing whole lines: take one line break with them.
      if (to < doc.length) to += 1;
      else if (from > 0) from -= 1;
    }
  } else if (hunk.newFrom < doc.lines) {
    from = to = doc.line(hunk.newFrom + 1).from;
    insert = `${old.join("\n")}\n`;
  } else {
    from = to = doc.length;
    insert = `\n${old.join("\n")}`;
  }
  view.dispatch({ changes: { from, to, insert }, userEvent: "revert", scrollIntoView: true });
}

class RemovedLinesWidget extends WidgetType {
  constructor(
    readonly lines: string[],
    readonly hunk: LineHunk,
  ) {
    super();
  }

  override eq(other: RemovedLinesWidget) {
    return (
      other.hunk.oldFrom === this.hunk.oldFrom &&
      other.hunk.oldTo === this.hunk.oldTo &&
      other.hunk.newFrom === this.hunk.newFrom &&
      other.hunk.newTo === this.hunk.newTo &&
      other.lines.join("\n") === this.lines.join("\n")
    );
  }

  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-git-removed";
    const bar = document.createElement("div");
    bar.className = "cm-git-removed-bar";
    const label = document.createElement("span");
    label.textContent =
      this.lines.length === 0
        ? t("editor.changeAdded")
        : this.hunk.newTo > this.hunk.newFrom
          ? t("editor.changeWas")
          : t("editor.changeRemoved");
    const revert = document.createElement("button");
    revert.type = "button";
    revert.className = "cm-git-revert";
    revert.textContent = t("editor.revertChange");
    revert.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    revert.addEventListener("click", (event) => {
      event.preventDefault();
      revertHunk(view, this.hunk);
    });
    bar.append(label, revert);
    box.appendChild(bar);
    for (const line of this.lines) {
      const row = document.createElement("div");
      row.className = "cm-git-removed-line";
      row.textContent = line || " ";
      box.appendChild(row);
    }
    return box;
  }

  override ignoreEvent() {
    return true;
  }
}

const bar = (color: string) => ({
  content: "''",
  position: "absolute",
  left: "-0.85em",
  top: "0",
  bottom: "0",
  width: "3px",
  borderRadius: "2px",
  background: color,
});

const theme = EditorView.baseTheme({
  ".cm-line.cm-git-added, .cm-line.cm-git-modified, .cm-line.cm-git-deleted-above, .cm-line.cm-git-deleted-below":
    { position: "relative" },
  ".cm-git-added::before": bar("var(--gn-success)"),
  ".cm-git-modified::before": bar("var(--gn-accent)"),
  ".cm-git-deleted-above::after, .cm-git-deleted-below::after": {
    content: "''",
    position: "absolute",
    left: "-0.95em",
    borderLeft: "5px solid var(--gn-danger)",
    borderTop: "4px solid transparent",
    borderBottom: "4px solid transparent",
  },
  ".cm-git-deleted-above::after": { top: "-4px" },
  ".cm-git-deleted-below::after": { bottom: "-4px" },
  ".cm-git-removed": {
    margin: "0.2em 0",
    borderLeft: "3px solid var(--gn-danger)",
    background: "color-mix(in oklab, var(--gn-danger) 8%, transparent)",
    borderRadius: "0 4px 4px 0",
    padding: "0.15em 0.6em 0.3em",
    fontSize: "0.92em",
  },
  ".cm-git-removed-bar": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5em",
    fontFamily: "var(--font-sans)",
    fontSize: "0.75em",
    color: "var(--gn-text-faint)",
  },
  ".cm-git-removed-line": {
    whiteSpace: "pre-wrap",
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in oklab, var(--gn-danger) 60%, transparent)",
    color: "var(--gn-text-muted)",
  },
  ".cm-git-revert": {
    font: "inherit",
    color: "var(--gn-accent)",
    background: "transparent",
    border: "none",
    padding: "0.1em 0.3em",
    borderRadius: "4px",
    cursor: "pointer",
  },
  ".cm-git-revert:hover": { background: "var(--gn-accent-soft)" },
  "&.cm-git-inline .cm-git-added, &.cm-git-inline .cm-git-modified": {
    background: "color-mix(in oklab, var(--gn-success) 9%, transparent)",
  },
});

const inlineClass = EditorView.editorAttributes.compute([changesField], (state) => ({
  class: state.field(changesField).inline ? "cm-git-inline" : "",
}));

/** Change markers and the inline diff. */
export function gitChanges() {
  return [changesField, theme, inlineClass];
}
