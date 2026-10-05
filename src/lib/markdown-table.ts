/**
 * GitHub-flavoured Markdown tables as plain text: split rows into cells, edit the grid and
 * print it back with aligned columns. The editor uses this for Tab navigation and the table
 * commands; it knows nothing about CodeMirror.
 */

export type Align = "left" | "center" | "right" | null;

/** A cell's trimmed content and where it sits, as offsets into its line. */
export interface SourceCell {
  text: string;
  from: number;
  to: number;
}

/** The editable content of a table: `rows[0]` is the header. */
export interface TableGrid {
  rows: string[][];
  align: Align[];
}

export interface ParsedTable extends TableGrid {
  /** Cells of every line as written, delimiter line included (index 1). */
  lines: SourceCell[][];
  /** Offset of each line in the table text. */
  lineStarts: number[];
}

/** Where a cell is in a table: `row` 0 is the header, body rows follow. */
export interface CellPos {
  row: number;
  col: number;
}

/** Splits one table line into cells on unescaped pipes; outer pipes are optional. */
export function splitRow(line: string): SourceCell[] {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "\\") i += 1;
    else if (line[i] === "|") pipes.push(i);
  }
  let from = line.length - line.trimStart().length;
  let to = line.trimEnd().length;
  if (pipes[0] === from) {
    pipes.shift();
    from += 1;
  }
  if (pipes.length > 0 && pipes[pipes.length - 1] === to - 1) {
    pipes.pop();
    to -= 1;
  }
  const bounds = [from - 1, ...pipes, to];
  const cells: SourceCell[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const rawFrom = (bounds[i] ?? 0) + 1;
    const rawTo = bounds[i + 1] ?? line.length;
    const raw = line.slice(rawFrom, rawTo);
    const text = raw.trim();
    // An empty cell's "content" is one space in, so the cursor lands inside the pipes.
    const start = text
      ? rawFrom + raw.length - raw.trimStart().length
      : Math.min(rawFrom + 1, rawTo);
    cells.push({ text, from: start, to: start + text.length });
  }
  return cells;
}

const DELIMITER_CELL = /^:?-+:?$/;

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/** Pads every row (and the alignment list) to the widest row, so no text is ever dropped. */
export function normalize(grid: TableGrid): TableGrid {
  const columns = Math.max(1, grid.align.length, ...grid.rows.map((r) => r.length));
  const pad = <T>(row: readonly T[], fill: T) => [
    ...row,
    ...Array<T>(columns - row.length).fill(fill),
  ];
  return { rows: grid.rows.map((r) => pad(r, "")), align: pad(grid.align, null) };
}

/** Parses a table's source (header, delimiter, body lines). Null if it is not a table. */
export function parseTable(text: string): ParsedTable | null {
  const sourceLines = text.split("\n");
  if (sourceLines.length < 2) return null;
  const lines = sourceLines.map(splitRow);
  const delimiter = lines[1] ?? [];
  if (delimiter.length === 0 || !delimiter.every((c) => DELIMITER_CELL.test(c.text))) {
    return null;
  }
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of sourceLines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const grid = normalize({
    rows: lines.filter((_, i) => i !== 1).map((cells) => cells.map((c) => c.text)),
    align: delimiter.map((c) => alignOf(c.text)),
  });
  return { ...grid, lines, lineStarts };
}

/** The grid cell under `offset` (an offset into the table text). */
export function cellAt(table: ParsedTable, offset: number): CellPos {
  let line = 0;
  while (line + 1 < table.lineStarts.length && (table.lineStarts[line + 1] ?? 0) <= offset) {
    line += 1;
  }
  const inLine = offset - (table.lineStarts[line] ?? 0);
  const cells = table.lines[line] ?? [];
  let col = 0;
  // A cell owns everything after the pipe that opens it.
  for (let i = 1; i < cells.length; i += 1) {
    if (inLine >= (cells[i]?.from ?? 0) - 1 && inLine > (cells[i - 1]?.to ?? 0)) col = i;
  }
  return { row: line <= 1 ? 0 : line - 1, col };
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}]/u;

/** Column width in a monospace font: wide East Asian characters and emoji take two cells. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

function delimiterFor(align: Align, width: number): string {
  if (align === "center") return `:${"-".repeat(width - 2)}:`;
  if (align === "left") return `:${"-".repeat(width - 1)}`;
  if (align === "right") return `${"-".repeat(width - 1)}:`;
  return "-".repeat(width);
}

export interface FormattedTable {
  text: string;
  /** Offsets of every cell's content in `text`, by grid row and column. */
  cells: { from: number; to: number }[][];
}

/** Prints the grid with every column padded to the same width. */
export function formatTable(input: TableGrid): FormattedTable {
  const grid = normalize(input);
  const widths = grid.align.map((align, col) =>
    Math.max(align === "center" ? 5 : 3, ...grid.rows.map((row) => displayWidth(row[col] ?? ""))),
  );
  const lines: string[] = [];
  const cells: { from: number; to: number }[][] = [];
  let offset = 0;
  const pushRow = (row: readonly string[]) => {
    let line = "|";
    const positions: { from: number; to: number }[] = [];
    row.forEach((cell, col) => {
      line += " ";
      positions.push({ from: offset + line.length, to: offset + line.length + cell.length });
      line += `${cell}${" ".repeat((widths[col] ?? 3) - displayWidth(cell))} |`;
    });
    lines.push(line);
    cells.push(positions);
    offset += line.length + 1;
  };
  const [header = [], ...body] = grid.rows;
  pushRow(header);
  const delimiter = `| ${grid.align.map((a, col) => delimiterFor(a, widths[col] ?? 3)).join(" | ")} |`;
  lines.push(delimiter);
  offset += delimiter.length + 1;
  for (const row of body) pushRow(row);
  return { text: lines.join("\n"), cells };
}

// ----------------------------------------------------------------------------------------
// Grid edits (pure: grid in, grid out)
// ----------------------------------------------------------------------------------------

/** Adds an empty body row before `at` (1 = first body row). */
export function insertRow(grid: TableGrid, at: number): TableGrid {
  const index = Math.max(1, Math.min(at, grid.rows.length));
  const empty = grid.align.map(() => "");
  return { ...grid, rows: [...grid.rows.slice(0, index), empty, ...grid.rows.slice(index)] };
}

/** Removes a body row; the header cannot be removed. */
export function deleteRow(grid: TableGrid, row: number): TableGrid {
  if (row < 1 || row >= grid.rows.length) return grid;
  return { ...grid, rows: grid.rows.filter((_, i) => i !== row) };
}

/** Adds an empty column before `at`. */
export function insertColumn(grid: TableGrid, at: number): TableGrid {
  const index = Math.max(0, Math.min(at, grid.align.length));
  const splice = <T>(list: readonly T[], value: T) => [
    ...list.slice(0, index),
    value,
    ...list.slice(index),
  ];
  return { rows: grid.rows.map((r) => splice(r, "")), align: splice(grid.align, null) };
}

/** Removes a column; the last remaining column is kept. */
export function deleteColumn(grid: TableGrid, col: number): TableGrid {
  if (grid.align.length <= 1 || col < 0 || col >= grid.align.length) return grid;
  return {
    rows: grid.rows.map((r) => r.filter((_, i) => i !== col)),
    align: grid.align.filter((_, i) => i !== col),
  };
}

export function setAlign(grid: TableGrid, col: number, align: Align): TableGrid {
  return { ...grid, align: grid.align.map((a, i) => (i === col ? align : a)) };
}

/** A new table with `columns` named header cells and one empty body row. */
export function newTable(columns: number, header: (n: number) => string): TableGrid {
  const names = Array.from({ length: columns }, (_, i) => header(i + 1));
  return { rows: [names, names.map(() => "")], align: names.map(() => null) };
}
