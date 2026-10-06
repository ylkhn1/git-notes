/**
 * Tags in the editor: the `#tag` syntax node (so tags inside code are never tags), the pill
 * styling, opening a tag's notes on click and completion of known tags after `#`.
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { MarkdownConfig } from "@lezer/markdown";

import { isMac } from "@/lib/platform";
import { isTagChar, isValidTag } from "@/lib/tags";

import { activeLines } from "./live-preview";

const HASH = 35; // #
const MAX_TAG_CHARS = 200;

/** Lezer Markdown extension: `#tag` after whitespace (or at the start) becomes a `Tag` node. */
export const tagSyntax: MarkdownConfig = {
  defineNodes: ["Tag"],
  parseInline: [
    {
      name: "Tag",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== HASH) return -1;
        if (pos > cx.offset && !/\s/.test(cx.slice(pos - 1, pos))) return -1;
        let body = "";
        for (const ch of cx.slice(pos + 1, Math.min(cx.end, pos + 1 + MAX_TAG_CHARS))) {
          if (!isTagChar(ch)) break;
          body += ch;
        }
        body = body.replace(/\/+$/, "");
        if (!isValidTag(body)) return -1;
        return cx.addElement(cx.elt("Tag", pos, pos + 1 + body.length));
      },
    },
  ],
};

export interface TagHooks {
  /** Known tags, most used first. */
  tags: () => readonly string[];
  onOpenTag: (tag: string) => void;
}

function tagDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Tag") return;
        const tag = view.state.sliceDoc(node.from + 1, node.to);
        ranges.push(
          Decoration.mark({ class: "cm-tag", attributes: { "data-tag": tag } }).range(
            node.from,
            node.to,
          ),
        );
      },
    });
  }
  return Decoration.set(ranges, true);
}

const tagPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tagDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = tagDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * A plain click on a tag opens its notes unless the cursor is on that line (then the click
 * edits); Ctrl/⌘-click always opens.
 */
function navigation(hooks: TagHooks) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.target instanceof Element)) return false;
      const el = event.target.closest<HTMLElement>("[data-tag]");
      if (!el) return false;
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod) {
        const line = view.state.doc.lineAt(view.posAtDOM(el)).number;
        if (activeLines(view.state).has(line)) return false;
      }
      event.preventDefault();
      hooks.onOpenTag(el.getAttribute("data-tag") ?? "");
      return true;
    },
  });
}

const MAX_OPTIONS = 50;

/** Completion of known tags after `#` (at least one character typed, so headings stay quiet). */
export function tagCompletion(hooks: TagHooks) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/(?:^|\s)#[\p{L}\p{N}_\-/]+$/u);
    if (!match) return null;
    const hash = match.text.lastIndexOf("#");
    const from = match.from + hash + 1;
    const typed = match.text.slice(hash + 1).toLowerCase();
    const known = hooks.tags();
    const starts = known.filter((t) => t.toLowerCase().startsWith(typed));
    const contains = known.filter(
      (t) => !t.toLowerCase().startsWith(typed) && t.toLowerCase().includes(typed),
    );
    const options: Completion[] = [...starts, ...contains]
      .filter((t) => t.toLowerCase() !== typed)
      .slice(0, MAX_OPTIONS)
      .map((tag) => ({ label: tag, type: "text" }));
    if (options.length === 0) return null;
    return { from, options, filter: false };
  };
}

const theme = EditorView.baseTheme({
  ".cm-tag": {
    color: "var(--gn-accent)",
    background: "var(--gn-accent-soft)",
    borderRadius: "4px",
    padding: "0 0.2em",
    cursor: "pointer",
  },
});

/** Tag styling and navigation (completion is registered with the other sources in setup). */
export function tagExtensions(hooks: TagHooks) {
  return [tagPlugin, navigation(hooks), theme];
}
