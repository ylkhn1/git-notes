import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  placeholder as placeholderExt,
  rectangularSelection,
} from "@codemirror/view";

import { getLocale, t } from "@/lib/i18n";

import { commands as formatting } from "./commands";
import { type ImageResolver, livePreview } from "./live-preview";
import { markdownHighlightStyle } from "./markdown-theme";
import { cmPhrases } from "./phrases";
import { type MountMenu, selectionMenu } from "./selection-menu";
import { type WikiLinkHooks, wikiLinks, wikiLinkSyntax } from "./wikilinks";

export interface EditorHooks {
  onChange: (text: string) => void;
  onSave: () => void;
  /** Receives image files pasted from the clipboard; must insert the Markdown itself. */
  onPasteImages: (files: File[], view: EditorView) => void;
  /** Maps Markdown image URLs to loadable URLs (relative paths → notebook protocol). */
  resolveImage: ImageResolver;
  /** Wiki links: note list, existence checks and navigation. */
  links: WikiLinkHooks;
  /** Desktop: renders the floating menu over a selection. Absent on touch devices. */
  selectionMenu?: MountMenu;
}

/** Full extension set for a Markdown note. */
export function markdownExtensions(hooks: EditorHooks): Extension {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      addKeymap: false,
      extensions: wikiLinkSyntax,
    }),
    syntaxHighlighting(markdownHighlightStyle),
    livePreview(hooks.resolveImage),
    wikiLinks(hooks.links),
    hooks.selectionMenu ? selectionMenu(hooks.selectionMenu) : [],
    placeholderExt(t("editor.placeholder")),
    cmPhrases(getLocale()),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          hooks.onSave();
          return true;
        },
      },
      { key: "Mod-b", run: formatting.bold },
      { key: "Mod-i", run: formatting.italic },
      { key: "Mod-e", run: formatting.code },
      { key: "Mod-k", run: formatting.link },
      { key: "Mod-Shift-x", run: formatting.task },
      ...closeBracketsKeymap,
      ...markdownKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) hooks.onChange(update.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      paste: (event, view) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        hooks.onPasteImages(files, view);
        return true;
      },
    }),
  ];
}

export function createEditorState(text: string, extensions: Extension): EditorState {
  return EditorState.create({ doc: text, extensions });
}

/** Inserts `snippet` at the main cursor, on its own line when the cursor is mid-text. */
export function insertAtCursor(view: EditorView, snippet: string) {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const needsNewlineBefore = from > line.from;
  const text = `${needsNewlineBefore ? "\n" : ""}${snippet}\n`;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}
