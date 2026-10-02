/**
 * Obsidian-style live preview for Markdown.
 *
 * Lines that do not touch the selection are rendered "as formatted": syntax markers are
 * hidden, bullets and checkboxes become widgets, images are shown inline. Lines that touch
 * the selection show their raw Markdown so the user can edit the markup. Everything is
 * derived from the Lezer syntax tree, so it stays correct while typing.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, Facet, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** Resolves an image URL from Markdown to something the webview can load; null hides it. */
export type ImageResolver = (url: string) => string | null;

export const imageResolver = Facet.define<ImageResolver, ImageResolver>({
  combine: (values) => values[0] ?? ((url) => (/^https?:\/\//i.test(url) ? url : null)),
});

// ----------------------------------------------------------------------------------------
// Widgets
// ----------------------------------------------------------------------------------------

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
  override ignoreEvent() {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  override eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-lp-checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "Mark task as not done" : "Mark task as done");
    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    input.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[x]" },
      });
    });
    return input;
  }
  override ignoreEvent() {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  override eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const figure = document.createElement("span");
    figure.className = "cm-lp-image";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    img.draggable = false;
    figure.appendChild(img);
    return figure;
  }
  override ignoreEvent() {
    return false;
  }
}

class HrWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-lp-hr";
    hr.setAttribute("role", "separator");
    return hr;
  }
}

class CodeLabelWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }
  override eq(other: CodeLabelWidget) {
    return other.lang === this.lang;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-codelabel";
    span.textContent = this.lang;
    return span;
  }
}

// ----------------------------------------------------------------------------------------
// Decoration builder (pure: state in, decorations out — unit tested)
// ----------------------------------------------------------------------------------------

const hide = Decoration.replace({});
const lineClass = (cls: string) => Decoration.line({ class: cls });
const markClass = (cls: string, attrs?: Record<string, string>) =>
  Decoration.mark({ class: cls, attributes: attrs });

interface Visible {
  from: number;
  to: number;
}

/** Line numbers that currently contain a selection endpoint or selected text. */
export function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number;
    const end = state.doc.lineAt(range.to).number;
    for (let n = start; n <= end; n += 1) lines.add(n);
  }
  return lines;
}

export function buildDecorations(state: EditorState, visible: readonly Visible[]): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const active = activeLines(state);
  const resolve = state.facet(imageResolver);
  const doc = state.doc;
  const isActive = (from: number, to: number) => {
    const start = doc.lineAt(from).number;
    const end = doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = start; n <= end; n += 1) if (active.has(n)) return true;
    return false;
  };
  const hideRange = (from: number, to: number) => {
    if (to > from) decorations.push(hide.range(from, to));
  };
  /** Hides a marker plus one following space, if present. */
  const hideMarkAndSpace = (node: SyntaxNode) => {
    const to = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
    hideRange(node.from, to);
  };

  for (const { from, to } of visible) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        // --- Headings -----------------------------------------------------------
        const atx = /^ATXHeading(\d)$/.exec(name);
        if (atx) {
          const line = doc.lineAt(node.from);
          decorations.push(lineClass(`cm-lp-heading cm-lp-h${atx[1] ?? "1"}`).range(line.from));
          if (!isActive(node.from, node.to)) {
            const mark = node.node.getChild("HeaderMark");
            if (mark) hideMarkAndSpace(mark);
          }
          return;
        }
        const setext = /^SetextHeading(\d)$/.exec(name);
        if (setext) {
          const first = doc.lineAt(node.from);
          decorations.push(lineClass(`cm-lp-heading cm-lp-h${setext[1] ?? "1"}`).range(first.from));
          if (!isActive(node.from, node.to)) {
            const mark = node.node.getChild("HeaderMark");
            // The underline lives on its own line; hide it together with the line break.
            if (mark) hideRange(Math.max(node.from, mark.from - 1), mark.to);
          }
          return;
        }

        // --- Inline emphasis ----------------------------------------------------------
        if (name === "Emphasis" || name === "StrongEmphasis" || name === "Strikethrough") {
          if (!isActive(node.from, node.to)) {
            for (const mark of node.node.getChildren(
              name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark",
            )) {
              hideRange(mark.from, mark.to);
            }
          }
          return;
        }

        // --- Inline code --------------------------------------------------------------
        if (name === "InlineCode") {
          const marks = node.node.getChildren("CodeMark");
          const first = marks[0];
          const last = marks[marks.length - 1];
          if (first && last && last !== first) {
            decorations.push(markClass("cm-lp-code").range(first.to, last.from));
            if (!isActive(node.from, node.to)) {
              hideRange(first.from, first.to);
              hideRange(last.from, last.to);
            }
          }
          return false;
        }

        // --- Links & images -----------------------------------------------------------
        if (name === "Image") {
          const url = node.node.getChild("URL");
          const src = url ? resolve(doc.sliceString(url.from, url.to)) : null;
          if (src && !isActive(node.from, node.to)) {
            const marks = node.node.getChildren("LinkMark");
            const open = marks[0];
            const close = marks[1];
            const alt = open && close ? doc.sliceString(open.to, close.from) : "";
            decorations.push(
              Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to),
            );
          }
          return false;
        }
        if (name === "Link") {
          const marks = node.node.getChildren("LinkMark");
          const url = node.node.getChild("URL");
          const open = marks[0];
          const close = marks[1];
          if (open && close) {
            const href = url ? doc.sliceString(url.from, url.to) : "";
            decorations.push(markClass("cm-lp-link", { title: href }).range(open.to, close.from));
            if (!isActive(node.from, node.to)) {
              hideRange(open.from, open.to);
              hideRange(close.from, node.to);
            }
          }
          return false;
        }

        // --- Lists & tasks ------------------------------------------------------------
        if (name === "ListItem") {
          const line = doc.lineAt(node.from);
          decorations.push(lineClass("cm-lp-list").range(line.from));
          return;
        }
        if (name === "ListMark") {
          const text = doc.sliceString(node.from, node.to);
          if (/^[-*+]$/.test(text) && !isActive(node.from, node.to)) {
            decorations.push(
              Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to),
            );
          }
          return;
        }
        if (name === "TaskMarker") {
          const text = doc.sliceString(node.from, node.to);
          const checked = /\[[xX]\]/.test(text);
          const line = doc.lineAt(node.from);
          decorations.push(
            lineClass(checked ? "cm-lp-task cm-lp-task-done" : "cm-lp-task").range(line.from),
          );
          if (!isActive(node.from, node.to)) {
            decorations.push(
              Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) }).range(
                node.from,
                node.to,
              ),
            );
          }
          return;
        }

        // --- Block quotes -------------------------------------------------------------
        if (name === "Blockquote") {
          const start = doc.lineAt(node.from).number;
          const end = doc.lineAt(node.to).number;
          for (let n = start; n <= end; n += 1) {
            decorations.push(lineClass("cm-lp-quote").range(doc.line(n).from));
          }
          return;
        }
        if (name === "QuoteMark") {
          if (!isActive(node.from, node.to)) hideMarkAndSpace(node.node);
          return;
        }

        // --- Fenced code --------------------------------------------------------------
        if (name === "FencedCode") {
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          for (let n = first.number; n <= last.number; n += 1) {
            const cls =
              n === first.number
                ? "cm-lp-codeblock cm-lp-codeblock-start"
                : n === last.number
                  ? "cm-lp-codeblock cm-lp-codeblock-end"
                  : "cm-lp-codeblock";
            decorations.push(lineClass(cls).range(doc.line(n).from));
          }
          const marks = node.node.getChildren("CodeMark");
          const info = node.node.getChild("CodeInfo");
          const openMark = marks[0];
          const closeMark = marks[1];
          if (openMark && !isActive(first.from, first.to)) {
            const lang = info ? doc.sliceString(info.from, info.to) : "";
            decorations.push(
              Decoration.replace({ widget: new CodeLabelWidget(lang || "code") }).range(
                first.from,
                first.to,
              ),
            );
          }
          if (closeMark && last.number !== first.number && !isActive(last.from, last.to)) {
            hideRange(closeMark.from, closeMark.to);
          }
          return;
        }

        // --- Horizontal rule ----------------------------------------------------------
        if (name === "HorizontalRule") {
          if (!isActive(node.from, node.to)) {
            decorations.push(
              Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to),
            );
          }
          return;
        }
        return;
      },
    });
  }

  return Decoration.set(decorations, true);
}

// ----------------------------------------------------------------------------------------
// View plugin + theme
// ----------------------------------------------------------------------------------------

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state, view.visibleRanges);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.state, update.view.visibleRanges);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const livePreviewTheme = EditorView.baseTheme({
  ".cm-lp-heading": { marginTop: "0.9em" },
  ".cm-lp-h1": { marginTop: "1.2em" },
  ".cm-lp-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "var(--gn-surface-2)",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  ".cm-lp-link": {
    color: "var(--gn-accent)",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  ".cm-lp-bullet": {
    display: "inline-block",
    width: "1ch",
    textAlign: "center",
    color: "var(--gn-text-muted)",
  },
  ".cm-lp-checkbox": {
    appearance: "none",
    width: "1.05em",
    height: "1.05em",
    margin: "0 0.1em 0 0",
    verticalAlign: "-0.15em",
    border: "1.5px solid var(--gn-border-strong)",
    borderRadius: "4px",
    background: "var(--gn-bg)",
    cursor: "pointer",
    display: "inline-grid",
    placeContent: "center",
  },
  ".cm-lp-checkbox:checked": {
    background: "var(--gn-accent)",
    borderColor: "var(--gn-accent)",
  },
  ".cm-lp-checkbox:checked::before": {
    content: "''",
    width: "0.55em",
    height: "0.3em",
    borderLeft: "2px solid var(--gn-accent-foreground)",
    borderBottom: "2px solid var(--gn-accent-foreground)",
    transform: "translateY(-0.1em) rotate(-45deg)",
  },
  ".cm-lp-task-done .cm-lp-task-text": { color: "var(--gn-text-muted)" },
  ".cm-lp-quote": {
    borderLeft: "3px solid var(--gn-border-strong)",
    paddingLeft: "0.9em !important",
    color: "var(--gn-text-muted)",
  },
  ".cm-lp-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "var(--gn-surface)",
    padding: "0 0.9em !important",
  },
  ".cm-lp-codeblock-start": { borderRadius: "6px 6px 0 0", paddingTop: "0.3em !important" },
  ".cm-lp-codeblock-end": { borderRadius: "0 0 6px 6px", paddingBottom: "0.3em !important" },
  ".cm-lp-codelabel": {
    fontFamily: "var(--font-sans)",
    fontSize: "0.75em",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--gn-text-faint)",
  },
  ".cm-lp-image": { display: "block", margin: "0.4em 0" },
  ".cm-lp-image img": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "60vh",
    borderRadius: "6px",
  },
  ".cm-lp-hr": {
    display: "block",
    height: "1px",
    margin: "0.7em 0",
    background: "var(--gn-border-strong)",
  },
});

/** Live preview extension: decorations plugin + styling. */
export function livePreview(resolve?: ImageResolver) {
  return [livePreviewPlugin, livePreviewTheme, resolve ? imageResolver.of(resolve) : []];
}
