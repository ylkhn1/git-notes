import { describe, expect, it } from "vitest";

import { diffLines, type LineHunk, toLines } from "./line-diff";

/** Applies hunks to `oldLines`, taking replacement lines from `newLines`; must give `newLines`. */
function apply(oldLines: string[], newLines: string[], hunks: LineHunk[]): string[] {
  const out: string[] = [];
  let pos = 0;
  for (const h of hunks) {
    out.push(...oldLines.slice(pos, h.oldFrom), ...newLines.slice(h.newFrom, h.newTo));
    pos = h.oldTo;
  }
  out.push(...oldLines.slice(pos));
  return out;
}

describe("diffLines", () => {
  it("returns nothing for equal texts", () => {
    expect(diffLines(["a", "b"], ["a", "b"])).toEqual([]);
    expect(diffLines([], [])).toEqual([]);
  });

  it("finds pure insertions and deletions", () => {
    expect(diffLines(["a", "c"], ["a", "b", "c"])).toEqual([
      { oldFrom: 1, oldTo: 1, newFrom: 1, newTo: 2 },
    ]);
    expect(diffLines(["a", "b", "c"], ["a", "c"])).toEqual([
      { oldFrom: 1, oldTo: 2, newFrom: 1, newTo: 1 },
    ]);
  });

  it("separates distant changes into hunks", () => {
    const before = ["one", "two", "three", "four", "five", "six"];
    const after = ["one", "TWO", "three", "four", "five", "six", "seven"];
    expect(diffLines(before, after)).toEqual([
      { oldFrom: 1, oldTo: 2, newFrom: 1, newTo: 2 },
      { oldFrom: 6, oldTo: 6, newFrom: 6, newTo: 7 },
    ]);
  });

  it("produces hunks that turn the old text into the new one", () => {
    const cases: [string, string][] = [
      ["a\nb\nc\nd\ne\n", "a\nx\nc\ny\nz\ne\n"],
      ["", "new\nnote\n"],
      ["gone\n", ""],
      ["x\ny\nx\ny\n", "y\nx\ny\nx\n"],
      ["# Title\n\nbody\n", "# Title 2\n\nbody\nmore\n"],
    ];
    for (const [before, after] of cases) {
      const a = toLines(before);
      const b = toLines(after);
      expect(apply(a, b, diffLines(a, b))).toEqual(b);
    }
  });

  it("splits lines like CodeMirror", () => {
    expect(toLines("a\r\nb\rc\n")).toEqual(["a", "b", "c", ""]);
  });
});
