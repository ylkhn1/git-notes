/**
 * Markdown tables in the editor.
 *
 * A top-level table that the selection does not touch is drawn as a real `<table>` (a block
 * widget, so it lives in a state field). Clicking a cell puts the cursor into that cell's
 * source, which live preview then shows as monospace text. While the cursor is in a table,
 * Tab / Shift-Tab / Enter move between cells, add rows as needed and re-align the columns.
 * The text model (splitting, formatting, grid edits) is `lib/markdown-table.ts`.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, Prec, type Range, StateField } from "@codemirror/state";
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { t } from "@/lib/i18n";
import {
  type Align,
  cellAt,
  type CellPos,
  deleteColumn,
  deleteRow,
  formatTable,
  insertColumn,
  insertRow,
  newTable,
  type ParsedTable,
  parseTable,
  setAlign,
  type TableGrid,
} from "@/lib/markdown-table";
import { parseWikiInner } from "@/lib/wikilinks";

import { activeLines, imageResolver, linkKind } from "./live-preview";
import { openLinkElement, refreshLinks, wikiLinkExists } from "./wikilinks";

// ----------------------------------------------------------------------------------------
// Finding tables
// ----------------------------------------------------------------------------------------

/** A top-level table: whole lines from the header line start to the last row's end. */
interface TableRange {
  from: number;
  to: number;
  node: SyntaxNode;
}

function rangeOf(state: EditorState, node: SyntaxNode): TableRange {
  return { from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.to).to, node };
}

/** Tables directly in the document; ones nested in quotes or lists stay plain text. */
function topLevelTables(state: EditorState): TableRange[] {
  const tables: TableRange[] = [];
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "Table") tables.push(rangeOf(state, node));
  }
  return tables;
}

function tableAt(state: EditorState, pos: number): TableRange | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "Table") {
        return node.parent?.name === "Document" ? rangeOf(state, node) : null;
      }
    }
  }
  return null;
}

/** True when a selection range touches one of the table's lines. */
function isActive(state: EditorState, range: TableRange, active: Set<number>) {
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  for (let n = first; n <= last; n += 1) if (active.has(n)) return true;
  return false;
}

// ----------------------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------------------

/** An inline syntax node, positions relative to the table start. */
interface InlineNode {
  name: string;
  from: number;
  to: number;
  children: InlineNode[];
}

interface CellData {
  /** Content range relative to the table start (a click puts the cursor at `to`). */
  from: number;
  to: number;
  nodes: InlineNode[];
}

interface TableData {
  source: string;
  align: Align[];
  rows: CellData[][];
}

function inlineNode(node: SyntaxNode, base: number): InlineNode {
  const children: InlineNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(inlineNode(child, base));
  }
  return { name: node.name, from: node.from - base, to: node.to - base, children };
}

/** Cells come from the text model; their inline markup from the syntax tree. */
function tableData(state: EditorState, range: TableRange): TableData | null {
  const source = state.sliceDoc(range.from, range.to);
  const table = parseTable(source);
  if (!table) return null;
  const inline: InlineNode[] = [];
  range.node.cursor().iterate((ref) => {
    if (ref.name !== "TableCell") return true;
    for (let child = ref.node.firstChild; child; child = child.nextSibling) {
      inline.push(inlineNode(child, range.from));
    }
    return false;
  });
  const columns = table.align.length;
  const rows = table.lines
    .map((cells, line) => ({ cells, line }))
    .filter(({ line }) => line !== 1)
    .map(({ cells, line }) => {
      const lineStart = table.lineStarts[line] ?? 0;
      const lineEnd = (table.lineStarts[line + 1] ?? source.length + 1) - 1;
      return Array.from({ length: columns }, (_, col): CellData => {
        const cell = cells[col];
        if (!cell) return { from: lineEnd, to: lineEnd, nodes: [] };
        const from = lineStart + cell.from;
        const to = lineStart + cell.to;
        return { from, to, nodes: inline.filter((n) => n.from >= from && n.to <= to) };
      });
    });
  return { source, align: table.align, rows };
}

const HIDDEN = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "WikiLinkMark",
  "URL",
  "LinkTitle",
  "LinkLabel",
]);
const WRAPPERS: Record<string, string> = {
  Emphasis: "em",
  StrongEmphasis: "strong",
  Strikethrough: "s",
};

/** Renders `src[from, to)` into `parent`, turning inline syntax nodes into elements. */
function renderRange(
  parent: HTMLElement,
  view: EditorView,
  src: string,
  from: number,
  to: number,
  nodes: readonly InlineNode[],
) {
  let pos = from;
  for (const node of nodes) {
    if (node.from < pos || node.to > to) continue;
    if (node.from > pos) parent.append(src.slice(pos, node.from));
    renderNode(parent, view, src, node);
    pos = node.to;
  }
  if (pos < to) parent.append(src.slice(pos, to));
}

/** Content between the first and last `mark` child (`**x**` → `x`). */
function inner(node: InlineNode, mark: string): [number, number] {
  const marks = node.children.filter((c) => c.name === mark);
  const open = marks[0];
  const close = marks[marks.length - 1];
  if (!open || !close || open === close) return [node.from, node.to];
  return [open.to, close.from];
}

function renderNode(parent: HTMLElement, view: EditorView, src: string, node: InlineNode) {
  const text = (from: number, to: number) => src.slice(from, to);
  const content = node.children.filter((c) => !HIDDEN.has(c.name));
  const tag = WRAPPERS[node.name];
  if (tag) {
    const el = document.createElement(tag);
    const mark = node.name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
    const [from, to] = inner(node, mark);
    renderRange(el, view, src, from, to, content);
    parent.append(el);
    return;
  }
  switch (node.name) {
    case "InlineCode": {
      const el = document.createElement("span");
      el.className = "cm-lp-code";
      const [from, to] = inner(node, "CodeMark");
      el.textContent = text(from, to);
      parent.append(el);
      return;
    }
    case "Link": {
      const [from, to] = inner(node, "LinkMark");
      const url = node.children.find((c) => c.name === "URL");
      const href = url ? text(url.from, url.to) : "";
      const el = document.createElement("span");
      const kind = linkKind(href);
      el.className = kind === "file" ? "cm-lp-link cm-lp-attachment" : "cm-lp-link";
      el.title = href;
      if (kind) {
        el.dataset.href = href;
        el.dataset.lpNav = "";
      }
      renderRange(el, view, src, from, to, content);
      parent.append(el);
      return;
    }
    case "WikiLink": {
      const [from, to] = inner(node, "WikiLinkMark");
      const raw = text(from, to);
      const parts = parseWikiInner(raw);
      const missing = parts.target !== "" && !view.state.facet(wikiLinkExists)(parts.target);
      const el = document.createElement("span");
      el.className = missing ? "cm-lp-wikilink cm-lp-wikilink-missing" : "cm-lp-wikilink";
      el.title = raw;
      el.dataset.wikilink = raw;
      el.dataset.lpNav = "";
      // `[[target|alias]]` shows only the alias, like in running text.
      const pipe = raw.indexOf("|");
      el.textContent = pipe !== -1 && parts.alias ? raw.slice(pipe + 1) : raw;
      parent.append(el);
      return;
    }
    case "Image": {
      const url = node.children.find((c) => c.name === "URL");
      const resolved = url ? view.state.facet(imageResolver)(text(url.from, url.to)) : null;
      const [from, to] = inner(node, "LinkMark");
      if (!resolved) {
        parent.append(text(from, to));
        return;
      }
      const img = document.createElement("img");
      img.src = resolved;
      img.alt = text(from, to);
      img.loading = "lazy";
      img.draggable = false;
      parent.append(img);
      return;
    }
    case "Escape":
      parent.append(text(node.from + 1, node.to));
      return;
    default:
      if (!HIDDEN.has(node.name)) renderRange(parent, view, src, node.from, node.to, content);
  }
}

/** Bumped when link targets change, so rendered tables redraw missing links. */
let generation = 0;

class TableWidget extends WidgetType {
  constructor(
    readonly data: TableData,
    readonly generation: number,
  ) {
    super();
  }

  override eq(other: TableWidget) {
    return other.data.source === this.data.source && other.generation === this.generation;
  }

  override get estimatedHeight() {
    return this.data.rows.length * 34 + 16;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-lp-table";
    const row = (cells: readonly CellData[], tag: "th" | "td") => {
      const tr = document.createElement("tr");
      cells.forEach((cell, col) => {
        const el = document.createElement(tag);
        const align = this.data.align[col];
        if (align) el.style.textAlign = align;
        el.dataset.cellEnd = String(cell.to);
        renderRange(el, view, this.data.source, cell.from, cell.to, cell.nodes);
        tr.append(el);
      });
      return tr;
    };
    const [header = [], ...body] = this.data.rows;
    const thead = document.createElement("thead");
    thead.append(row(header, "th"));
    const tbody = document.createElement("tbody");
    for (const cells of body) tbody.append(row(cells, "td"));
    table.append(thead, tbody);
    wrap.append(table);

    // The editor ignores events inside widgets, so the table handles its own clicks: links
    // open, anything else moves the cursor into the clicked cell (right click too, so the
    // context menu then offers the table actions).
    wrap.addEventListener("mousedown", (event) => {
      if (!(event.target instanceof Element)) return;
      event.preventDefault();
      const link = event.target.closest("[data-lp-nav]");
      if (link && event.button === 0 && openLinkElement(view, link)) return;
      const cell = event.target.closest<HTMLElement>("[data-cell-end]");
      const end = Number(cell?.dataset.cellEnd ?? 0);
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) + end }, userEvent: "select" });
      view.focus();
    });
    return wrap;
  }
}

function buildTables(state: EditorState): DecorationSet {
  const active = activeLines(state);
  const widgets: Range<Decoration>[] = [];
  for (const range of topLevelTables(state)) {
    if (isActive(state, range, active)) continue;
    const data = tableData(state, range);
    if (!data) continue;
    const widget = new TableWidget(data, generation);
    widgets.push(Decoration.replace({ widget, block: true }).range(range.from, range.to));
  }
  return Decoration.set(widgets);
}

const tableField = StateField.define<DecorationSet>({
  create: buildTables,
  update(value, tr) {
    const refreshed = tr.effects.some((effect) => effect.is(refreshLinks));
    if (refreshed) generation += 1;
    if (
      tr.docChanged ||
      tr.selection ||
      refreshed ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return buildTables(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ----------------------------------------------------------------------------------------
// Editing
// ----------------------------------------------------------------------------------------

interface TableContext extends TableRange {
  table: ParsedTable;
  cell: CellPos;
}

/** The table and cell the (single) cursor is in. */
function tableContext(state: EditorState): TableContext | null {
  if (state.selection.ranges.length !== 1) return null;
  const { head, from, to } = state.selection.main;
  const range = tableAt(state, head);
  if (!range || from < range.from || to > range.to) return null;
  const table = parseTable(state.sliceDoc(range.from, range.to));
  if (!table) return null;
  return { ...range, table, cell: cellAt(table, head - range.from) };
}

/** Is the cursor in a table? (Menus show the table actions then.) */
export function inTable(state: EditorState): boolean {
  return tableContext(state) !== null;
}

/** Can the row under the cursor be deleted? (Not the header.) */
export function canDeleteRow(state: EditorState): boolean {
  const ctx = tableContext(state);
  return ctx !== null && ctx.cell.row > 0;
}

/** Can the column under the cursor be deleted? (Not the only one.) */
export function canDeleteColumn(state: EditorState): boolean {
  const ctx = tableContext(state);
  return ctx !== null && ctx.table.align.length > 1;
}

/** The alignment of the column under the cursor (undefined outside tables). */
export function columnAlign(state: EditorState): Align | undefined {
  const ctx = tableContext(state);
  return ctx ? (ctx.table.align[ctx.cell.col] ?? null) : undefined;
}

/**
 * Replaces the table with the formatted `grid` and moves to `target`: its content is selected
 * when navigating (typing replaces it, like in a spreadsheet), else the cursor goes after it.
 */
function apply(
  view: EditorView,
  ctx: TableContext,
  grid: TableGrid,
  target: CellPos,
  select = false,
) {
  const formatted = formatTable(grid);
  const cell = formatted.cells[target.row]?.[target.col] ?? { from: 0, to: 0 };
  const current = view.state.sliceDoc(ctx.from, ctx.to);
  view.dispatch({
    changes:
      formatted.text === current ? [] : { from: ctx.from, to: ctx.to, insert: formatted.text },
    selection: { anchor: ctx.from + (select ? cell.from : cell.to), head: ctx.from + cell.to },
    scrollIntoView: true,
    userEvent: "input.table",
  });
  return true;
}

/** Runs `edit` on the table under the cursor; false (the key falls through) elsewhere. */
const withTable =
  (edit: (view: EditorView, ctx: TableContext) => boolean): Command =>
  (view) => {
    const ctx = tableContext(view.state);
    return ctx ? edit(view, ctx) : false;
  };

/** Tab: the next cell, wrapping to the next row; a new row after the last cell. */
export const nextCell = withTable((view, ctx) => {
  const { row, col } = ctx.cell;
  if (col + 1 < ctx.table.align.length)
    return apply(view, ctx, ctx.table, { row, col: col + 1 }, true);
  if (row + 1 < ctx.table.rows.length) {
    return apply(view, ctx, ctx.table, { row: row + 1, col: 0 }, true);
  }
  return apply(view, ctx, insertRow(ctx.table, row + 1), { row: row + 1, col: 0 }, true);
});

/** Shift-Tab: the previous cell, wrapping to the previous row. */
export const previousCell = withTable((view, ctx) => {
  const { row, col } = ctx.cell;
  if (col > 0) return apply(view, ctx, ctx.table, { row, col: col - 1 }, true);
  if (row > 0) {
    return apply(view, ctx, ctx.table, { row: row - 1, col: ctx.table.align.length - 1 }, true);
  }
  return apply(view, ctx, ctx.table, ctx.cell, true);
});

/** Enter: the cell below (a new row at the end). Enter on an empty last row leaves the table. */
export const nextRow = withTable((view, ctx) => {
  const { row, col } = ctx.cell;
  const last = ctx.table.rows.length - 1;
  if (row === last && row > 0 && ctx.table.rows[row]?.every((cell) => cell === "")) {
    // A table runs until a blank line, so the cursor goes below one.
    const { text } = formatTable(deleteRow(ctx.table, row));
    view.dispatch({
      changes: { from: ctx.from, to: ctx.to, insert: `${text}\n\n` },
      selection: { anchor: ctx.from + text.length + 2 },
      scrollIntoView: true,
      userEvent: "input.table",
    });
    return true;
  }
  if (row < last) return apply(view, ctx, ctx.table, { row: row + 1, col }, true);
  return apply(view, ctx, insertRow(ctx.table, row + 1), { row: row + 1, col }, true);
});

export const addRowAbove = withTable((view, ctx) => {
  const row = Math.max(1, ctx.cell.row);
  return apply(view, ctx, insertRow(ctx.table, row), { row, col: ctx.cell.col });
});

export const addRowBelow = withTable((view, ctx) => {
  const row = ctx.cell.row + 1;
  return apply(view, ctx, insertRow(ctx.table, row), { row, col: ctx.cell.col });
});

export const addColumnLeft = withTable((view, ctx) =>
  apply(view, ctx, insertColumn(ctx.table, ctx.cell.col), ctx.cell),
);

export const addColumnRight = withTable((view, ctx) => {
  const col = ctx.cell.col + 1;
  return apply(view, ctx, insertColumn(ctx.table, col), { row: ctx.cell.row, col });
});

export const deleteTableRow = withTable((view, ctx) => {
  if (ctx.cell.row === 0) return false;
  const grid = deleteRow(ctx.table, ctx.cell.row);
  const row = Math.min(ctx.cell.row, grid.rows.length - 1);
  return apply(view, ctx, grid, { row, col: ctx.cell.col });
});

export const deleteTableColumn = withTable((view, ctx) => {
  if (ctx.table.align.length <= 1) return false;
  const grid = deleteColumn(ctx.table, ctx.cell.col);
  const col = Math.min(ctx.cell.col, grid.align.length - 1);
  return apply(view, ctx, grid, { row: ctx.cell.row, col });
});

/** Removes the whole table together with its line break. */
export const deleteTable = withTable((view, ctx) => {
  const length = view.state.doc.length;
  const to = ctx.to < length ? ctx.to + 1 : ctx.to;
  const from = to === ctx.to && ctx.from > 0 ? ctx.from - 1 : ctx.from;
  view.dispatch({
    changes: { from, to },
    selection: { anchor: from },
    scrollIntoView: true,
    userEvent: "delete.table",
  });
  return true;
});

export const alignColumn = (align: Align): Command =>
  withTable((view, ctx) => apply(view, ctx, setAlign(ctx.table, ctx.cell.col, align), ctx.cell));

export const formatTableAtCursor = withTable((view, ctx) => apply(view, ctx, ctx.table, ctx.cell));

/**
 * Inserts a 3-column table after the cursor line (or in place of an empty line), with blank
 * lines around it so it does not merge with neighbouring text, and selects the first header.
 */
export const insertTable: Command = (view) => {
  const { doc } = view.state;
  const line = doc.lineAt(view.state.selection.main.to);
  const empty = line.text.trim() === "";
  const prev = line.number > 1 ? doc.line(line.number - 1) : null;
  const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
  const before = empty ? (prev && prev.text.trim() !== "" ? "\n" : "") : "\n\n";
  const after = next && next.text.trim() !== "" ? "\n" : "";
  const formatted = formatTable(newTable(3, (n) => t("editor.tableColumn", { n })));
  const from = empty ? line.from : line.to;
  const first = formatted.cells[0]?.[0] ?? { from: 0, to: 0 };
  const start = from + before.length;
  view.dispatch({
    changes: { from, to: line.to, insert: before + formatted.text + after },
    selection: { anchor: start + first.from, head: start + first.to },
    scrollIntoView: true,
    userEvent: "input.table",
  });
  return true;
};

// ----------------------------------------------------------------------------------------
// Extension
// ----------------------------------------------------------------------------------------

const theme = EditorView.baseTheme({
  ".cm-lp-table-wrap": {
    overflowX: "auto",
    padding: "0.35em 0",
  },
  ".cm-lp-table": {
    borderCollapse: "collapse",
    fontSize: "0.95em",
    lineHeight: "1.5",
  },
  ".cm-lp-table th, .cm-lp-table td": {
    border: "1px solid var(--gn-border)",
    padding: "0.3em 0.75em",
    textAlign: "left",
    verticalAlign: "top",
    cursor: "text",
    minWidth: "3em",
    // The editor wraps lines anywhere; in a cell that squeezes columns down to single
    // letters on a phone. Break between words and let the table scroll sideways instead.
    whiteSpace: "normal",
    overflowWrap: "normal",
    wordBreak: "normal",
  },
  ".cm-lp-table th": {
    background: "var(--gn-surface)",
    fontWeight: "600",
  },
  ".cm-lp-table tbody tr:nth-child(even) td": {
    background: "color-mix(in srgb, var(--gn-surface) 50%, transparent)",
  },
  ".cm-lp-table img": { maxHeight: "8em", maxWidth: "100%", verticalAlign: "middle" },
  ".cm-lp-table-src": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
  },
  // Highlighting shrinks inline code; inside a table source every character must be one
  // column wide, or the pipes stop lining up.
  ".cm-lp-table-src *": {
    fontFamily: "inherit !important",
    fontSize: "inherit !important",
  },
  ".cm-lp-table-delim": { color: "var(--gn-text-faint)" },
});

export interface TableHooks {
  /** Called after every cursor move with whether it is in a table (mobile toolbar). */
  onContextChange?: (inTable: boolean) => void;
}

export function tables(hooks: TableHooks = {}) {
  const notify = hooks.onContextChange;
  return [
    tableField,
    theme,
    Prec.high(
      keymap.of([
        { key: "Tab", run: nextCell, shift: previousCell },
        { key: "Enter", run: nextRow },
      ]),
    ),
    notify
      ? EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet) notify(inTable(update.state));
        })
      : [],
  ];
}
