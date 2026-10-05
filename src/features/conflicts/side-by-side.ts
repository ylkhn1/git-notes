import type { FileDiff } from "@/lib/bindings";

/** One line of one side. */
export interface Cell {
  /** 1-based line number in that file. */
  no: number;
  text: string;
}

/** A row of the side-by-side view: equal lines, or a change with either side possibly empty. */
export type SideRow =
  | { kind: "same"; left: Cell; right: Cell }
  | { kind: "changed"; left: Cell | null; right: Cell | null };

/** Rows grouped for display: visible runs and collapsed runs of unchanged lines. */
export type RowBlock = { kind: "lines"; rows: SideRow[] } | { kind: "collapsed"; rows: SideRow[] };

/** Splits text into lines, treating a trailing newline as a terminator rather than an extra line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Aligns the whole old and new texts of a diff into side-by-side rows. Lines outside the
 * hunks are equal by construction; inside a hunk, runs of removed and added lines are paired
 * up index by index.
 */
export function alignRows(diff: FileDiff): SideRow[] {
  if (diff.binary) return [];
  const oldLines = splitLines(diff.oldText ?? "");
  const newLines = splitLines(diff.newText ?? "");
  const rows: SideRow[] = [];
  let oldPos = 1;
  let newPos = 1;

  const same = (leftNo: number, rightNo: number, text: string) => {
    rows.push({ kind: "same", left: { no: leftNo, text }, right: { no: rightNo, text } });
  };

  const hunks = [...diff.hunks].sort((a, b) => a.oldStart - b.oldStart);
  for (const hunk of hunks) {
    // Unchanged lines between the previous hunk and this one.
    const firstOld = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart;
    while (oldPos < firstOld && oldPos <= oldLines.length && newPos <= newLines.length) {
      same(oldPos, newPos, oldLines[oldPos - 1] ?? "");
      oldPos += 1;
      newPos += 1;
    }

    let removed: Cell[] = [];
    let added: Cell[] = [];
    const flush = () => {
      const count = Math.max(removed.length, added.length);
      for (let i = 0; i < count; i += 1) {
        rows.push({ kind: "changed", left: removed[i] ?? null, right: added[i] ?? null });
      }
      removed = [];
      added = [];
    };

    for (const line of hunk.lines) {
      if (line.kind === "context") {
        flush();
        same(line.oldNo ?? oldPos, line.newNo ?? newPos, line.text);
        oldPos = (line.oldNo ?? oldPos) + 1;
        newPos = (line.newNo ?? newPos) + 1;
      } else if (line.kind === "delete") {
        removed.push({ no: line.oldNo ?? oldPos, text: line.text });
        oldPos = (line.oldNo ?? oldPos) + 1;
      } else {
        added.push({ no: line.newNo ?? newPos, text: line.text });
        newPos = (line.newNo ?? newPos) + 1;
      }
    }
    flush();
  }

  // Unchanged tail after the last hunk.
  while (oldPos <= oldLines.length && newPos <= newLines.length) {
    same(oldPos, newPos, oldLines[oldPos - 1] ?? "");
    oldPos += 1;
    newPos += 1;
  }
  // Only reachable if the hunks and texts disagree; never drop lines silently.
  while (oldPos <= oldLines.length) {
    rows.push({
      kind: "changed",
      left: { no: oldPos, text: oldLines[oldPos - 1] ?? "" },
      right: null,
    });
    oldPos += 1;
  }
  while (newPos <= newLines.length) {
    rows.push({
      kind: "changed",
      left: null,
      right: { no: newPos, text: newLines[newPos - 1] ?? "" },
    });
    newPos += 1;
  }
  return rows;
}

export interface CollapseOptions {
  /** Unchanged lines kept visible on each side of a change. */
  context: number;
  /** Runs of unchanged lines shorter than this are never collapsed. */
  minRun: number;
}

export const defaultCollapse: CollapseOptions = { context: 3, minRun: 8 };

/**
 * Folds long runs of unchanged rows so a one-line conflict in a long note is visible at a
 * glance. Runs touching the start or end of the file keep context only on the inner side.
 */
export function collapseUnchanged(
  rows: SideRow[],
  options: CollapseOptions = defaultCollapse,
): RowBlock[] {
  const blocks: RowBlock[] = [];
  const visible: SideRow[] = [];
  const pushVisible = (slice: SideRow[]) => {
    visible.push(...slice);
  };
  const flushVisible = () => {
    if (visible.length > 0) blocks.push({ kind: "lines", rows: visible.splice(0) });
  };

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row === undefined) break;
    if (row.kind !== "same") {
      pushVisible([row]);
      i += 1;
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end]?.kind === "same") end += 1;
    const run = rows.slice(i, end);
    const atStart = i === 0;
    const atEnd = end === rows.length;
    const keepBefore = atStart ? 0 : options.context;
    const keepAfter = atEnd ? 0 : options.context;
    if (run.length >= options.minRun && run.length > keepBefore + keepAfter) {
      pushVisible(run.slice(0, keepBefore));
      flushVisible();
      blocks.push({ kind: "collapsed", rows: run.slice(keepBefore, run.length - keepAfter) });
      pushVisible(run.slice(run.length - keepAfter));
    } else {
      pushVisible(run);
    }
    i = end;
  }
  flushVisible();
  return blocks;
}

/** How many rows differ, for the dialog summary. */
export function countChanges(rows: SideRow[]): number {
  return rows.filter((r) => r.kind === "changed").length;
}
