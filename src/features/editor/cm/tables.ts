/**
 * Markdown tables in the editor, edited in place like in Obsidian.
 *
 * Every top-level table is drawn as a real `<table>` (a block widget, so it lives in a state
 * field); the Markdown source with its pipes and `---` line is never shown. The cell under
 * the cursor gets a small editor of its own holding the cell's Markdown: its edits go
 * straight into the cell's source, and the note's selection follows its cursor, so menus,
 * the formatting toolbar and undo act on the cell. Tab / Shift-Tab / Enter / arrows move
 * between cells; "+" bars on the right and bottom edges add a column or a row. A table that
 * was edited is re-aligned when the cursor leaves it.
 * The text model (splitting, formatting, grid edits) is `lib/markdown-table.ts`.
 */
import { redo, standardKeymap, undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import {
  Annotation,
  type ChangeDesc,
  type ChangeSpec,
  EditorState,
  type Extension,
  Prec,
  type Range,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  type Command,
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
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

import { commands as formatting } from "./commands";
import { layoutIndependentKeys } from "./layout-keys";
import { imageResolver, linkKind } from "./live-preview";
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

/** The top-level table whose first line starts at `from`. */
function tableStartingAt(state: EditorState, from: number): TableRange | null {
  return topLevelTables(state).find((range) => range.from === from) ?? null;
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

/** Class of the cell that holds a cell editor. */
const EDITING = "cm-lp-cell-editing";

/** Draws grid cell (`row`, `col`) into its `<th>`/`<td>`. */
function fillCell(el: HTMLElement, view: EditorView, data: TableData, row: number, col: number) {
  const cell = data.rows[row]?.[col];
  el.dataset.row = String(row);
  el.dataset.col = String(col);
  el.style.textAlign = data.align[col] ?? "";
  el.replaceChildren();
  if (cell) renderRange(el, view, data.source, cell.from, cell.to, cell.nodes);
}

function addButton(kind: "row" | "column") {
  const label = t(kind === "row" ? "editor.addRow" : "editor.addColumn");
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = `cm-lp-table-add cm-lp-table-add-${kind}`;
  button.dataset.tableAdd = kind;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.textContent = "+";
  return button;
}

/**
 * The editor ignores events inside widgets, so the table handles its own clicks: "+" adds a
 * row or column, links open, anything else opens the clicked cell (right click too, so the
 * context menu then offers the table actions). The open cell's editor handles its own.
 */
function onTableMouseDown(view: EditorView, wrap: HTMLElement, event: MouseEvent) {
  if (!(event.target instanceof Element) || event.target.closest(`.${EDITING}`)) return;
  event.preventDefault();
  const editing = view.plugin(tableEditing);
  if (!editing) return;
  const add = event.target.closest<HTMLElement>("[data-table-add]");
  if (add) {
    if (event.button === 0)
      editing.addLine(wrap, add.dataset.tableAdd === "row" ? "row" : "column");
    return;
  }
  const link = event.target.closest("[data-lp-nav]");
  if (link && event.button === 0 && openLinkElement(view, link)) return;
  const cell = event.target.closest<HTMLElement>("[data-row]");
  if (!cell) return;
  const pointer = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  editing.openCell(wrap, Number(cell.dataset.row), Number(cell.dataset.col), pointer);
}

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
    return this.data.rows.length * 34 + 34;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table-wrap";
    const box = document.createElement("div");
    box.className = "cm-lp-table-box";
    const table = document.createElement("table");
    table.className = "cm-lp-table";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    this.data.rows.forEach((cells, row) => {
      const tr = document.createElement("tr");
      cells.forEach((_, col) => {
        const el = document.createElement(row === 0 ? "th" : "td");
        fillCell(el, view, this.data, row, col);
        tr.append(el);
      });
      (row === 0 ? thead : tbody).append(tr);
    });
    table.append(thead, tbody);
    box.append(table, addButton("column"), addButton("row"));
    wrap.append(box);
    wrap.addEventListener("mousedown", (event) => {
      onTableMouseDown(view, wrap, event);
    });
    return wrap;
  }

  /** Same shape: redraw the cells in place, leaving the one being edited alone. */
  override updateDOM(dom: HTMLElement, view: EditorView) {
    const table = dom.querySelector("table");
    if (table?.rows.length !== this.data.rows.length) return false;
    const rows = Array.from(table.rows);
    if (rows.some((tr) => tr.cells.length !== this.data.align.length)) return false;
    rows.forEach((tr, row) => {
      Array.from(tr.cells).forEach((el, col) => {
        if (!el.classList.contains(EDITING)) fillCell(el, view, this.data, row, col);
      });
    });
    return true;
  }
}

function buildTables(state: EditorState): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  for (const range of topLevelTables(state)) {
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
    if (tr.docChanged || refreshed || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
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
// Editing a cell in place
// ----------------------------------------------------------------------------------------

/** Grid row `row` is this line of the table text (line 1 is the delimiter). */
const lineOfRow = (row: number) => (row === 0 ? 0 : row + 1);

/** A cell's content in the document, or null for a cell a short row lacks. */
function cellSpan(ctx: TableRange & { table: ParsedTable }, row: number, col: number) {
  const line = lineOfRow(row);
  const cell = ctx.table.lines[line]?.[col];
  if (!cell) return null;
  const start = ctx.from + (ctx.table.lineStarts[line] ?? 0);
  return { from: start + cell.from, to: start + cell.to, text: cell.text };
}

/** The table starting at `from`, nominally at its first cell. */
function contextAt(state: EditorState, from: number): TableContext | null {
  const range = tableStartingAt(state, from);
  const table = range && parseTable(state.sliceDoc(range.from, range.to));
  return range && table ? { ...range, table, cell: { row: 0, col: 0 } } : null;
}

/** Puts the cursor at the start or end of a cell; a cell missing from a short row is made. */
function moveToCell(view: EditorView, ctx: TableContext, target: CellPos, end: boolean) {
  const span = cellSpan(ctx, target.row, target.col);
  if (!span) return apply(view, ctx, ctx.table, target);
  view.dispatch({
    selection: { anchor: end ? span.to : span.from },
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

/** Moves the cursor onto the line above (`-1`) or below the table, adding one if needed. */
function leaveTable(view: EditorView, ctx: TableRange, side: -1 | 1) {
  const { length } = view.state.doc;
  const spec =
    side < 0
      ? ctx.from > 0
        ? { selection: { anchor: ctx.from - 1 } }
        : { changes: { from: 0, insert: "\n" }, selection: { anchor: 0 } }
      : ctx.to < length
        ? { selection: { anchor: ctx.to + 1 } }
        : { changes: { from: ctx.to, insert: "\n" }, selection: { anchor: ctx.to + 1 } };
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: "select" });
  return true;
}

/** Re-aligns the columns of the table at `from`; false when there was nothing to do. */
function formatTableAt(view: EditorView, from: number): boolean {
  const ctx = contextAt(view.state, from);
  if (!ctx) return false;
  const { text } = formatTable(ctx.table);
  if (text === view.state.sliceDoc(ctx.from, ctx.to)) return false;
  view.dispatch({
    changes: { from: ctx.from, to: ctx.to, insert: text },
    userEvent: "input.table",
  });
  return true;
}

/** Marks cell-editor transactions that copy the note into the cell (not to be echoed back). */
const fromNote = Annotation.define<boolean>();

/** A cell is one line of a row: line breaks become spaces and pipes are escaped. */
const cellInputFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const fixes: ChangeSpec[] = [];
  tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    const text = inserted.toString();
    for (let i = 0; i < text.length; i += 1) {
      const before = i > 0 ? text[i - 1] : tr.newDoc.sliceString(fromB - 1, fromB);
      if (text[i] === "\n") fixes.push({ from: fromB + i, to: fromB + i + 1, insert: " " });
      else if (text[i] === "|" && before !== "\\") fixes.push({ from: fromB + i, insert: "\\" });
    }
  });
  return fixes.length > 0 ? [tr, { changes: fixes, sequential: true }] : tr;
});

/** Is the cursor on the first (`-1`) or last visual line of the cell? */
function onEdgeLine(view: EditorView, side: -1 | 1): boolean {
  const here = view.coordsAtPos(view.state.selection.main.head);
  const edge = view.coordsAtPos(side < 0 ? 0 : view.state.doc.length);
  return !here || !edge || Math.abs(here.top - edge.top) < 2;
}

/** The small editor in the open cell, kept in step with the cell's source in the note. */
class CellEditor {
  readonly view: EditorView;
  /** Whether this cell's text was changed (the table is re-aligned after leaving it). */
  edited = false;

  constructor(
    readonly note: EditorView,
    readonly host: HTMLElement,
    /** Start of the table in the note. */
    public tableFrom: number,
    readonly row: number,
    readonly col: number,
    /** Where the cell editor's text starts in the note. */
    public start: number,
    text: string,
  ) {
    host.classList.add(EDITING);
    host.replaceChildren();
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        selection: this.noteSelection(text.length),
        extensions: this.extensions(),
      }),
    });
  }

  map(changes: ChangeDesc) {
    this.start = changes.mapPos(this.start, -1);
    this.tableFrom = changes.mapPos(this.tableFrom, -1);
  }

  /** The note's selection, relative to the cell and clipped to it. */
  private noteSelection(length: number) {
    const { anchor, head } = this.note.state.selection.main;
    const clip = (pos: number) => Math.max(0, Math.min(length, pos - this.start));
    return { anchor: clip(anchor), head: clip(head) };
  }

  /** Takes changes made to the cell through the note (undo, toolbar) and its selection. */
  pull(ctx: TableContext) {
    const span = cellSpan(ctx, this.row, this.col);
    if (!span) return;
    const text = this.view.state.doc.toString();
    const inStep =
      span.text === text.trim() &&
      this.note.state.sliceDoc(this.start, this.start + text.length) === text;
    if (!inStep) {
      this.start = span.from;
      this.edited = true;
    }
    const length = inStep ? text.length : span.text.length;
    const selection = this.noteSelection(length);
    const current = this.view.state.selection.main;
    if (inStep && current.anchor === selection.anchor && current.head === selection.head) return;
    this.view.dispatch({
      changes: inStep ? [] : { from: 0, to: text.length, insert: span.text },
      selection,
      annotations: fromNote.of(true),
    });
  }

  /** Copies the cell editor's edits and selection into the note. */
  private push(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet) return;
    if (update.transactions.some((tr) => tr.annotation(fromNote))) return;
    const changes: ChangeSpec[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({ from: this.start + fromA, to: this.start + toA, insert: inserted.toString() });
    });
    if (update.docChanged) this.edited = true;
    const { anchor, head } = update.state.selection.main;
    const userEvent = update.transactions
      .map((tr) => tr.annotation(Transaction.userEvent))
      .find((event) => event !== undefined);
    this.note.dispatch({
      changes,
      selection: { anchor: this.start + anchor, head: this.start + head },
      userEvent,
    });
  }

  private extensions(): Extension {
    const note = this.note;
    /** Runs `move` on the table under the note's cursor (the cell's table). */
    const inTable = (move: (ctx: TableContext) => boolean) => () => {
      const ctx = tableContext(note.state);
      return ctx ? move(ctx) : false;
    };
    const vertical = (side: -1 | 1) => (view: EditorView) =>
      view.state.selection.main.empty &&
      onEdgeLine(view, side) &&
      inTable((ctx) => {
        const row = ctx.cell.row + side;
        if (row < 0 || row >= ctx.table.rows.length) return leaveTable(note, ctx, side);
        return moveToCell(note, ctx, { row, col: ctx.cell.col }, side < 0);
      })();
    const horizontal = (side: -1 | 1) => (view: EditorView) => {
      const { empty, head } = view.state.selection.main;
      if (!empty || head !== (side < 0 ? 0 : view.state.doc.length)) return false;
      return inTable((ctx) => {
        const columns = ctx.table.align.length;
        const index = ctx.cell.row * columns + ctx.cell.col + side;
        if (index < 0 || index >= ctx.table.rows.length * columns) {
          return leaveTable(note, ctx, side);
        }
        const target = { row: Math.floor(index / columns), col: index % columns };
        return moveToCell(note, ctx, target, side < 0);
      })();
    };
    /** Shortcuts the cell editor lacks run in the note, whose selection mirrors the cell's. */
    const onNote = (command: Command) => () => command(note);
    return [
      drawSelection(),
      EditorView.lineWrapping,
      cellInputFilter,
      layoutIndependentKeys,
      Prec.high(
        keymap.of([
          { key: "Tab", run: onNote(nextCell), shift: onNote(previousCell) },
          { key: "Enter", run: onNote(nextRow) },
          { key: "Escape", run: inTable((ctx) => leaveTable(note, ctx, 1)) },
          { key: "ArrowUp", run: vertical(-1) },
          { key: "ArrowDown", run: vertical(1) },
          { key: "ArrowLeft", run: horizontal(-1) },
          { key: "ArrowRight", run: horizontal(1) },
          { key: "Mod-b", run: onNote(formatting.bold) },
          { key: "Mod-i", run: onNote(formatting.italic) },
          { key: "Mod-e", run: onNote(formatting.code) },
          { key: "Mod-k", run: onNote(formatting.link) },
          { key: "Mod-f", run: onNote(openSearchPanel) },
          { key: "Mod-z", run: onNote(undo), preventDefault: true },
          { key: "Mod-y", mac: "Mod-Shift-z", run: onNote(redo), preventDefault: true },
          { key: "Mod-Shift-z", run: onNote(redo), preventDefault: true },
        ]),
      ),
      keymap.of(standardKeymap),
      EditorView.updateListener.of((update) => {
        this.push(update);
      }),
    ];
  }
}

/**
 * Opens a cell editor in the cell under the note's cursor while the note is being edited,
 * and moves it as the cursor moves between cells.
 */
class TableEditing {
  private cell: CellEditor | null = null;
  /** The cell editor had focus: the next one (or the note) takes it over. */
  private refocus = false;
  /** Start of an edited table the cursor just left; it gets re-aligned. */
  private left: number | null = null;
  /** Where a click opened the cell, to put the cursor there. */
  private pointer: { x: number; y: number } | null = null;
  private scheduled = false;
  private destroyed = false;

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    if (update.docChanged && this.left !== null) this.left = update.changes.mapPos(this.left);
    const cell = this.cell;
    if (cell) {
      if (update.docChanged) cell.map(update.changes);
      if (cell.view.hasFocus) this.refocus = true;
      const ctx = tableContext(update.state);
      const sameTable = ctx?.from === cell.tableFrom;
      if (!sameTable || ctx.cell.row !== cell.row || ctx.cell.col !== cell.col) {
        if (!sameTable && cell.edited) this.left = cell.tableFrom;
        this.close(update.state);
      }
    }
    if (this.cell || this.left !== null || update.selectionSet || update.focusChanged) {
      this.schedule();
    }
  }

  destroy() {
    this.destroyed = true;
    this.close(null);
  }

  /** A click on a cell of the table drawn in `wrap`. */
  openCell(wrap: HTMLElement, row: number, col: number, pointer: { x: number; y: number } | null) {
    const ctx = contextAt(this.view.state, this.view.posAtDOM(wrap));
    if (!ctx) return;
    this.pointer = pointer;
    // The cell editor takes focus straight away: focusing the note with its cursor under the
    // table would make it read the browser selection back as a spot below the table.
    this.refocus = true;
    moveToCell(this.view, ctx, { row, col }, true);
  }

  /** "+" on the table's bottom (`row`) or right edge (`column`). */
  addLine(wrap: HTMLElement, kind: "row" | "column") {
    const ctx = contextAt(this.view.state, this.view.posAtDOM(wrap));
    if (!ctx) return;
    const { table } = ctx;
    this.refocus = true;
    if (kind === "row") {
      apply(this.view, ctx, insertRow(table, table.rows.length), {
        row: table.rows.length,
        col: 0,
      });
    } else {
      apply(this.view, ctx, insertColumn(table, table.align.length), {
        row: 0,
        col: table.align.length,
      });
    }
  }

  /** DOM work waits until the view has drawn the update. */
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) this.sync();
    });
  }

  private sync() {
    const { view } = this;
    const ctx = tableContext(view.state);
    if (this.left !== null) {
      const left = this.left;
      this.left = null;
      // The dispatch schedules another round.
      if (ctx?.from !== left && formatTableAt(view, left)) return;
    }
    // The table was drawn anew; the editor went away with the old cells.
    if (this.cell && !this.cell.host.isConnected) this.close(null);
    const refocus = this.refocus;
    this.refocus = false;
    if (!ctx) {
      this.pointer = null;
      if (refocus) view.focus();
      return;
    }
    if (this.cell) {
      this.cell.pull(ctx);
      if (view.hasFocus) this.cell.view.focus();
      return;
    }
    if (refocus || view.hasFocus) this.open(ctx);
  }

  private open(ctx: TableContext) {
    const { row, col } = ctx.cell;
    const span = cellSpan(ctx, row, col);
    if (!span) {
      // A short row: padding it first gives the cell a place in the source.
      apply(this.view, ctx, ctx.table, ctx.cell);
      return;
    }
    const wrap = Array.from(
      this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-lp-table-wrap"),
    ).find((el) => this.view.posAtDOM(el) === ctx.from);
    const host = wrap?.querySelector<HTMLElement>(
      `[data-row="${String(row)}"][data-col="${String(col)}"]`,
    );
    if (!host) return;
    const cell = new CellEditor(this.view, host, ctx.from, row, col, span.from, span.text);
    this.cell = cell;
    cell.view.focus();
    const pointer = this.pointer;
    this.pointer = null;
    const pos = pointer ? cell.view.posAtCoords(pointer) : null;
    if (pos !== null) {
      cell.view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
    }
  }

  /** Removes the cell editor and draws the cell again (from `state`, when still there). */
  private close(state: EditorState | null) {
    const cell = this.cell;
    if (!cell) return;
    this.cell = null;
    cell.view.destroy();
    cell.host.classList.remove(EDITING);
    const range = state && tableStartingAt(state, cell.tableFrom);
    const data = state && range && tableData(state, range);
    if (data && cell.host.isConnected) fillCell(cell.host, this.view, data, cell.row, cell.col);
  }
}

const tableEditing = ViewPlugin.fromClass(TableEditing);

// ----------------------------------------------------------------------------------------
// Extension
// ----------------------------------------------------------------------------------------

const theme = EditorView.baseTheme({
  ".cm-lp-table-wrap": {
    overflowX: "auto",
    padding: "0.35em 0",
  },
  // Room on the right and below for the "+" bars, inside the scrolling area.
  ".cm-lp-table-box": {
    position: "relative",
    width: "max-content",
    padding: "0 1.25rem 1.25rem 0",
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
  [`.cm-lp-table .${EDITING}`]: {
    outline: "2px solid var(--gn-accent)",
    outlineOffset: "-1px",
  },
  ".cm-lp-table-add": {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    border: "none",
    borderRadius: "4px",
    background: "var(--gn-surface)",
    color: "var(--gn-text-muted)",
    font: "inherit",
    fontSize: "0.9rem",
    lineHeight: "1",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 120ms",
  },
  ".cm-lp-table-add:hover": {
    background: "var(--gn-accent-soft)",
    color: "var(--gn-accent)",
  },
  ".cm-lp-table-add-column": { top: "0", right: "0.1rem", bottom: "1.25rem", width: "1rem" },
  ".cm-lp-table-add-row": { left: "0", right: "1.25rem", bottom: "0.1rem", height: "1rem" },
  ".cm-lp-table-box:hover .cm-lp-table-add": { opacity: "1" },
  // No hover on touch screens: keep the bars visible, just quieter.
  "@media (hover: none)": { ".cm-lp-table-add": { opacity: "0.6" } },
});

export interface TableHooks {
  /** Called after every cursor move with whether it is in a table (mobile toolbar). */
  onContextChange?: (inTable: boolean) => void;
}

export function tables(hooks: TableHooks = {}) {
  const notify = hooks.onContextChange;
  return [
    tableField,
    tableEditing,
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
