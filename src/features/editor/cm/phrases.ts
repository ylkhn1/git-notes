import { EditorState, type Extension } from "@codemirror/state";

import { type Locale, type MessageKey, t } from "@/lib/i18n";

/** CodeMirror's English phrase → our message key. CodeMirror substitutes `$` itself. */
const PHRASES: Record<string, MessageKey> = {
  Find: "editor.cmFind",
  Replace: "editor.cmReplace",
  next: "editor.cmNext",
  previous: "editor.cmPrevious",
  all: "editor.cmAll",
  "match case": "editor.cmMatchCase",
  "by word": "editor.cmByWord",
  regexp: "editor.cmRegexp",
  replace: "editor.cmReplaceAction",
  "replace all": "editor.cmReplaceAll",
  close: "editor.cmClose",
  "current match": "editor.cmCurrentMatch",
  "replaced $ matches": "editor.cmReplacedMatches",
  "replaced match on line $": "editor.cmReplacedMatchOnLine",
  "on line": "editor.cmOnLine",
  "Go to line": "editor.cmGoToLine",
  go: "editor.cmGo",
  "Control character": "editor.cmControlCharacter",
  "Selection deleted": "editor.cmSelectionDeleted",
  "Folded lines": "editor.cmFoldedLines",
  "Unfolded lines": "editor.cmUnfoldedLines",
  to: "editor.cmTo",
  "folded code": "editor.cmFoldedCode",
  unfold: "editor.cmUnfold",
  "Fold line": "editor.cmFoldLine",
  "Unfold line": "editor.cmUnfoldLine",
  Completions: "editor.cmCompletions",
};

/** Translated UI phrases for CodeMirror's own panels (search, go to line, folding). */
export function cmPhrases(locale: Locale): Extension {
  if (locale === "en") return [];
  return EditorState.phrases.of(
    Object.fromEntries(Object.entries(PHRASES).map(([phrase, key]) => [phrase, t(key)])),
  );
}
