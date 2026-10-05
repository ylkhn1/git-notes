import { describe, expect, it } from "vitest";

import type { DiffHunk, DiffLine, FileDiff } from "@/lib/bindings";

import { alignRows, collapseUnchanged, countChanges, splitLines } from "./side-by-side";

function line(kind: DiffLine["kind"], oldNo: number | null, newNo: number | null, text: string) {
  return { kind, oldNo, newNo, text };
}

function diff(oldText: string | null, newText: string | null, hunks: DiffHunk[]): FileDiff {
  return { path: "n.md", kind: "modified", binary: false, hunks, oldText, newText };
}

describe("splitLines", () => {
  it("treats the trailing newline as a terminator", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("alignRows", () => {
  it("returns equal rows when nothing changed", () => {
    const rows = alignRows(diff("a\nb\n", "a\nb\n", []));
    expect(rows).toEqual([
      { kind: "same", left: { no: 1, text: "a" }, right: { no: 1, text: "a" } },
      { kind: "same", left: { no: 2, text: "b" }, right: { no: 2, text: "b" } },
    ]);
    expect(countChanges(rows)).toBe(0);
  });

  it("pairs removed and added lines inside a hunk and keeps the rest aligned", () => {
    const oldText = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
    const newText = "1\n2\n3\n4\nX\nY\n6\n7\n8\n9\n";
    const hunk: DiffHunk = {
      header: "@@ -2,7 +2,8 @@",
      oldStart: 2,
      oldLines: 7,
      newStart: 2,
      newLines: 8,
      lines: [
        line("context", 2, 2, "2"),
        line("context", 3, 3, "3"),
        line("context", 4, 4, "4"),
        line("delete", 5, null, "5"),
        line("add", null, 5, "X"),
        line("add", null, 6, "Y"),
        line("context", 6, 7, "6"),
        line("context", 7, 8, "7"),
        line("context", 8, 9, "8"),
      ],
    };
    const rows = alignRows(diff(oldText, newText, [hunk]));
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({
      kind: "same",
      left: { no: 1, text: "1" },
      right: { no: 1, text: "1" },
    });
    expect(rows[4]).toEqual({
      kind: "changed",
      left: { no: 5, text: "5" },
      right: { no: 5, text: "X" },
    });
    expect(rows[5]).toEqual({ kind: "changed", left: null, right: { no: 6, text: "Y" } });
    expect(rows[9]).toEqual({
      kind: "same",
      left: { no: 9, text: "9" },
      right: { no: 10, text: "9" },
    });
    expect(countChanges(rows)).toBe(2);
  });

  it("shows a copy whose original is gone as all-new", () => {
    const hunk: DiffHunk = {
      header: "@@ -0,0 +1,2 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      lines: [line("add", null, 1, "a"), line("add", null, 2, "b")],
    };
    const rows = alignRows({ ...diff(null, "a\nb\n", [hunk]), kind: "added" });
    expect(rows).toEqual([
      { kind: "changed", left: null, right: { no: 1, text: "a" } },
      { kind: "changed", left: null, right: { no: 2, text: "b" } },
    ]);
  });

  it("never drops lines when hunks and texts disagree", () => {
    const rows = alignRows(diff("a\nb\nc\n", "a\n", []));
    expect(rows.map((r) => r.kind)).toEqual(["same", "changed", "changed"]);
  });

  it("is empty for binary files", () => {
    expect(alignRows({ ...diff(null, null, []), binary: true })).toEqual([]);
  });
});

describe("collapseUnchanged", () => {
  const same = (n: number) =>
    ({ kind: "same", left: { no: n, text: String(n) }, right: { no: n, text: "" } }) as const;
  const changed = (n: number) =>
    ({ kind: "changed", left: { no: n, text: "" }, right: null }) as const;

  it("keeps short files fully visible", () => {
    const rows = [same(1), changed(2), same(3)];
    expect(collapseUnchanged(rows)).toEqual([{ kind: "lines", rows }]);
  });

  it("folds long unchanged runs leaving context around changes", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => same(i + 1)),
      changed(13),
      ...Array.from({ length: 12 }, (_, i) => same(i + 14)),
    ];
    const blocks = collapseUnchanged(rows, { context: 2, minRun: 5 });
    expect(blocks.map((b) => [b.kind, b.rows.length])).toEqual([
      ["collapsed", 10],
      ["lines", 5],
      ["collapsed", 10],
    ]);
    const visible = blocks[1];
    expect(visible?.rows.map((r) => (r.kind === "same" ? r.left.no : "x"))).toEqual([
      11,
      12,
      "x",
      14,
      15,
    ]);
  });

  it("does not fold runs shorter than the minimum", () => {
    const rows = [changed(1), ...Array.from({ length: 6 }, (_, i) => same(i + 2)), changed(8)];
    expect(collapseUnchanged(rows, { context: 2, minRun: 8 })).toEqual([{ kind: "lines", rows }]);
  });
});
