/**
 * Highlights the terms of the sidebar search in the open note, so a note opened from the
 * results shows where it matched. Matching is case-insensitive, like the search itself.
 */
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/** The lower-case terms to highlight; an empty list clears the highlight. */
export const setSearchTerms = StateEffect.define<readonly string[]>();

const mark = Decoration.mark({ class: "cm-search-term" });

function build(state: EditorState, terms: readonly string[]): DecorationSet {
  if (terms.length === 0) return Decoration.none;
  const text = state.doc.toString();
  const lower = text.toLowerCase();
  // Lower-casing can change string length (rare, e.g. "İ"); then offsets would drift.
  if (lower.length !== text.length) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  for (const term of terms) {
    if (!term) continue;
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
      ranges.push(mark.range(at, at + term.length));
    }
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<{ terms: readonly string[]; decorations: DecorationSet }>({
  create: () => ({ terms: [], decorations: Decoration.none }),
  update(value, tr) {
    let terms = value.terms;
    for (const effect of tr.effects) if (effect.is(setSearchTerms)) terms = effect.value;
    if (terms === value.terms && !tr.docChanged) return value;
    return { terms, decorations: build(tr.state, terms) };
  },
  provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
});

const theme = EditorView.baseTheme({
  ".cm-search-term": {
    background: "color-mix(in oklab, var(--gn-warning) 35%, transparent)",
    borderRadius: "2px",
  },
});

export function searchMarks() {
  return [field, theme];
}
