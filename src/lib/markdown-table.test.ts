import { describe, expect, it } from "vitest";

import {
  cellAt,
  deleteColumn,
  deleteRow,
  displayWidth,
  formatTable,
  insertColumn,
  insertRow,
  newTable,
  parseTable,
  setAlign,
  splitRow,
} from "./markdown-table";

describe("splitRow", () => {
  it("splits on pipes and trims cells", () => {
    expect(splitRow("| a | bb |").map((c) => c.text)).toEqual(["a", "bb"]);
    expect(splitRow("a | b").map((c) => c.text)).toEqual(["a", "b"]);
    expect(splitRow("  | a |").map((c) => c.text)).toEqual(["a"]);
  });

  it("keeps escaped pipes inside a cell", () => {
    expect(splitRow("| a \\| b | c |").map((c) => c.text)).toEqual(["a \\| b", "c"]);
  });

  it("reports content offsets, inside the pipes for empty cells", () => {
    const [a, empty] = splitRow("| ab |    |");
    expect(a).toEqual({ text: "ab", from: 2, to: 4 });
    expect(empty).toEqual({ text: "", from: 7, to: 7 });
  });
});

describe("parseTable", () => {
  const source = "| Name | Qty |\n|:-----|----:|\n| tea | 2 |\n| milk |";

  it("reads header, alignment and body; pads short rows", () => {
    const table = parseTable(source);
    expect(table?.rows).toEqual([
      ["Name", "Qty"],
      ["tea", "2"],
      ["milk", ""],
    ]);
    expect(table?.align).toEqual(["left", "right"]);
  });

  it("rejects text without a delimiter row", () => {
    expect(parseTable("| a |\n| b |")).toBeNull();
    expect(parseTable("| a |")).toBeNull();
  });

  it("finds the cell under an offset", () => {
    const table = parseTable(source);
    if (!table) throw new Error("not a table");
    expect(cellAt(table, 2)).toEqual({ row: 0, col: 0 });
    expect(cellAt(table, source.indexOf("Qty"))).toEqual({ row: 0, col: 1 });
    expect(cellAt(table, source.indexOf("tea") + 3)).toEqual({ row: 1, col: 0 });
    expect(cellAt(table, source.indexOf("| 2") + 1)).toEqual({ row: 1, col: 1 });
    // The delimiter line counts as the header row.
    expect(cellAt(table, source.indexOf("----:"))).toEqual({ row: 0, col: 1 });
  });
});

describe("formatTable", () => {
  it("pads columns and keeps alignment markers", () => {
    const { text } = formatTable({
      rows: [
        ["Name", "Qty", "Note"],
        ["tea", "12", ""],
      ],
      align: ["left", "right", "center"],
    });
    expect(text).toBe(
      ["| Name | Qty | Note  |", "| :--- | --: | :---: |", "| tea  | 12  |       |"].join("\n"),
    );
  });

  it("reports where each cell's content is", () => {
    const formatted = formatTable({
      rows: [
        ["a", "b"],
        ["", "cd"],
      ],
      align: [null, null],
    });
    const cell = formatted.cells[1]?.[1];
    expect(cell && formatted.text.slice(cell.from, cell.to)).toBe("cd");
    const empty = formatted.cells[1]?.[0];
    expect(empty && formatted.text[empty.from - 1]).toBe(" ");
  });

  it("round-trips through parseTable", () => {
    const grid = {
      rows: [
        ["Задача", "Срок"],
        ["Отчёт \\| черновик", "пт"],
      ],
      align: [null, "center" as const],
    };
    const parsed = parseTable(formatTable(grid).text);
    expect(parsed?.rows).toEqual(grid.rows);
    expect(parsed?.align).toEqual(grid.align);
  });

  it("counts wide characters twice", () => {
    expect(displayWidth("日本")).toBe(4);
    expect(displayWidth("Идея")).toBe(4);
  });
});

describe("grid edits", () => {
  const grid = {
    rows: [
      ["a", "b"],
      ["1", "2"],
    ],
    align: [null, "right" as const],
  };

  it("inserts and deletes rows below the header only", () => {
    expect(insertRow(grid, 0).rows).toEqual([
      ["a", "b"],
      ["", ""],
      ["1", "2"],
    ]);
    expect(insertRow(grid, 9).rows.at(-1)).toEqual(["", ""]);
    expect(deleteRow(grid, 0)).toBe(grid);
    expect(deleteRow(grid, 1).rows).toEqual([["a", "b"]]);
  });

  it("inserts and deletes columns, keeping the last one", () => {
    const wider = insertColumn(grid, 1);
    expect(wider.rows).toEqual([
      ["a", "", "b"],
      ["1", "", "2"],
    ]);
    expect(wider.align).toEqual([null, null, "right"]);
    const single = deleteColumn(grid, 0);
    expect(single.rows).toEqual([["b"], ["2"]]);
    expect(deleteColumn(single, 0)).toBe(single);
  });

  it("sets alignment and builds new tables", () => {
    expect(setAlign(grid, 0, "center").align).toEqual(["center", "right"]);
    expect(newTable(2, (n) => `Col ${String(n)}`).rows).toEqual([
      ["Col 1", "Col 2"],
      ["", ""],
    ]);
  });
});
