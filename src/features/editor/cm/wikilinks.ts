/**
 * Wiki links in the editor: the `[[…]]` syntax node, autocompletion of note names after
 * `[[`, opening links on click, and the "link to note" command. Which file a link points
 * to is decided by `lib/wikilinks.ts`; the editor gets the note list through hooks.
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorSelection, Facet, StateEffect } from "@codemirror/state";
import { type Command, EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

import { rankItems } from "@/lib/fuzzy";
import { displayTitle, parentOf } from "@/lib/paths";
import { isMac } from "@/lib/platform";
import { linkTargetFor, parseWikiInner, type WikiParts, withoutExtension } from "@/lib/wikilinks";

const BRACKET_OPEN = 91; // [
const BRACKET_CLOSE = 93; // ]
const NEWLINE = 10;

/** Lezer Markdown extension: `[[inner]]` on one line becomes a `WikiLink` node. */
export const wikiLinkSyntax: MarkdownConfig = {
  defineNodes: [
    // No highlight style: live preview colours the link itself (missing links differ).
    "WikiLink",
    { name: "WikiLinkMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== BRACKET_OPEN || cx.char(pos + 1) !== BRACKET_OPEN) return -1;
        let end = pos + 2;
        for (; end < cx.end; end += 1) {
          const c = cx.char(end);
          if (c === NEWLINE || c === BRACKET_OPEN) return -1;
          if (c === BRACKET_CLOSE) {
            if (cx.char(end + 1) !== BRACKET_CLOSE) return -1;
            break;
          }
        }
        if (end >= cx.end || cx.slice(pos + 2, end).trim() === "") return -1;
        return cx.addElement(
          cx.elt("WikiLink", pos, end + 2, [
            cx.elt("WikiLinkMark", pos, pos + 2),
            cx.elt("WikiLinkMark", end, end + 2),
          ]),
        );
      },
    },
  ],
};

export interface WikiLinkHooks {
  /** Markdown notes of the open notebook. */
  notes: () => readonly string[];
  /** Path of the note being edited. */
  currentPath: () => string;
  /** Does `target` resolve to an existing note from the current one? */
  exists: (target: string) => boolean;
  onOpenWikiLink: (parts: WikiParts) => void;
  /** A Markdown link `[text](href)` to a local file was activated. */
  onOpenHref: (href: string) => void;
}

/** Tells live preview whether a link target exists (missing links are drawn dimmed). */
export const wikiLinkExists = Facet.define<
  (target: string) => boolean,
  (target: string) => boolean
>({
  combine: (values) => values[0] ?? (() => true),
});

/** Dispatched when the note list changed, so link decorations are recomputed. */
export const refreshLinks = StateEffect.define();

const MAX_OPTIONS = 50;

function completionSource(hooks: WikiLinkHooks) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^[\]|#\n]*$/);
    if (!match) return null;
    const query = match.text.slice(2);
    const notes = hooks.notes();
    const from = hooks.currentPath();
    const ranked = query.trim()
      ? rankItems(notes, query, (p) => withoutExtension(p), MAX_OPTIONS).map((r) => r.item)
      : [...notes].sort((a, b) => a.localeCompare(b)).slice(0, MAX_OPTIONS);
    const options: Completion[] = ranked
      .filter((p) => p !== from)
      .map((path) => {
        const text = linkTargetFor(path, notes, from);
        return {
          label: text,
          displayLabel: displayTitle(path),
          detail: parentOf(path) || undefined,
          type: "text",
          apply: (view: EditorView, _completion: Completion, start: number, end: number) => {
            const closed = view.state.sliceDoc(end, end + 2) === "]]";
            const insert = closed ? text : `${text}]]`;
            view.dispatch({
              changes: { from: start, to: end, insert },
              selection: { anchor: start + text.length + 2 },
              userEvent: "input.complete",
            });
          },
        };
      });
    return { from: match.from + 2, options, filter: false };
  };
}

/** The hooks of the editor a widget lives in, so widgets can open links too. */
const linkHooks = Facet.define<WikiLinkHooks, WikiLinkHooks | null>({
  combine: (values) => values[0] ?? null,
});

/** Opens the note a rendered link element (`data-wikilink` / `data-href`) points to. */
export function openLinkElement(view: EditorView, el: Element): boolean {
  const hooks = view.state.facet(linkHooks);
  if (!hooks) return false;
  const wiki = el.getAttribute("data-wikilink");
  if (wiki !== null) hooks.onOpenWikiLink(parseWikiInner(wiki));
  else hooks.onOpenHref(el.getAttribute("data-href") ?? "");
  return true;
}

/** Plain click on a rendered link (or Ctrl/⌘-click anywhere on a link) opens it. */
const navigation = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const el = event.target.closest<HTMLElement>("[data-wikilink], [data-href]");
    if (!el) return false;
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod && !el.hasAttribute("data-lp-nav")) return false;
    event.preventDefault();
    return openLinkElement(view, el);
  },
});

/** Wraps the selection in `[[…]]`, or inserts `[[]]` and opens the note list. */
export const insertWikiLink: Command = (view) => {
  const range = view.state.selection.main;
  if (range.empty) {
    view.dispatch({
      changes: { from: range.from, insert: "[[]]" },
      selection: EditorSelection.cursor(range.from + 2),
      userEvent: "input.format",
    });
    startCompletion(view);
    return true;
  }
  const text = view.state.sliceDoc(range.from, range.to).replace(/\s*\n\s*/g, " ");
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[[${text}]]` },
    selection: EditorSelection.range(range.from + 2, range.from + 2 + text.length),
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
};

// `theme`, not `baseTheme`: it has to win over the autocompletion package's own styles.
const theme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--gn-border)",
    borderRadius: "8px",
    background: "var(--gn-surface)",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
    padding: "4px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-sans)",
    fontSize: "0.85rem",
    maxHeight: "16em",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    borderRadius: "4px",
    padding: "3px 8px !important",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "var(--gn-accent-soft)",
    color: "var(--gn-text)",
  },
  ".cm-completionDetail": {
    marginLeft: "0.75em",
    fontStyle: "normal",
    color: "var(--gn-text-faint)",
  },
});

/** Everything wiki-link related for one editor. */
export function wikiLinks(hooks: WikiLinkHooks) {
  return [
    wikiLinkExists.of(hooks.exists),
    linkHooks.of(hooks),
    autocompletion({ override: [completionSource(hooks)], icons: false }),
    navigation,
    theme,
  ];
}
