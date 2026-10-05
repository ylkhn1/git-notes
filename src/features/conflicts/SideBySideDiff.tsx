import { useState } from "react";

import type { FileDiff } from "@/lib/bindings";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { alignRows, collapseUnchanged, type Cell, type SideRow } from "./side-by-side";

interface Props {
  diff: FileDiff;
  /** Two columns on wide screens; one column with removed/added pairs on phones. */
  layout: "split" | "stacked";
  leftLabel: string;
  rightLabel: string;
}

/** Whole-file comparison of the current note and its conflict copy. */
export function SideBySideDiff({ diff, layout, leftLabel, rightLabel }: Props) {
  const [expanded, setExpanded] = useState<Record<number, true>>({});
  const t = useT();
  if (diff.binary) {
    return <Empty>{t("conflicts.binaryNotComparable")}</Empty>;
  }
  const rows = alignRows(diff);
  if (rows.length === 0) return <Empty>{t("conflicts.bothEmpty")}</Empty>;
  const blocks = collapseUnchanged(rows);
  const split = layout === "split";

  return (
    <div className="font-mono text-xs leading-5">
      {split && (
        <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-line bg-surface font-sans text-2xs font-medium text-muted-text uppercase">
          <div className="truncate px-3 py-1">{leftLabel}</div>
          <div className="truncate border-l border-line px-3 py-1">{rightLabel}</div>
        </div>
      )}
      <table className={cn("w-full table-fixed border-collapse", split && "[&_td]:w-1/2")}>
        <tbody>
          {blocks.map((block, index) => {
            if (block.kind === "collapsed" && !expanded[index]) {
              return (
                <tr key={index}>
                  <td colSpan={split ? 2 : 1} className="p-0">
                    <button
                      type="button"
                      className="block w-full bg-surface-2 px-3 py-1 text-center font-sans text-xs text-muted-text hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      onClick={() => setExpanded((e) => ({ ...e, [index]: true }))}
                    >
                      ⋯ {t("conflicts.unchangedLines", { count: block.rows.length })}
                    </button>
                  </td>
                </tr>
              );
            }
            return block.rows.map((row, j) =>
              split ? (
                <SplitRow key={`${String(index)}-${String(j)}`} row={row} />
              ) : (
                <StackedRows key={`${String(index)}-${String(j)}`} row={row} />
              ),
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SplitRow({ row }: { row: SideRow }) {
  if (row.kind === "same") {
    return (
      <tr>
        <Side cell={row.left} tone="same" />
        <Side cell={row.right} tone="same" border />
      </tr>
    );
  }
  return (
    <tr>
      <Side cell={row.left} tone={row.left ? "removed" : "filler"} />
      <Side cell={row.right} tone={row.right ? "added" : "filler"} border />
    </tr>
  );
}

function StackedRows({ row }: { row: SideRow }) {
  if (row.kind === "same") {
    return (
      <tr>
        <Side cell={row.left} tone="same" />
      </tr>
    );
  }
  return (
    <>
      {row.left && (
        <tr>
          <Side cell={row.left} tone="removed" marker="−" />
        </tr>
      )}
      {row.right && (
        <tr>
          <Side cell={row.right} tone="added" marker="+" />
        </tr>
      )}
    </>
  );
}

function Side({
  cell,
  tone,
  border = false,
  marker,
}: {
  cell: Cell | null;
  tone: "same" | "removed" | "added" | "filler";
  border?: boolean;
  marker?: string;
}) {
  const t = useT();
  return (
    <td
      className={cn(
        "align-top",
        border && "border-l border-line",
        tone === "removed" && "bg-danger/10",
        tone === "added" && "bg-success/10",
        tone === "filler" && "bg-surface-2/60",
      )}
    >
      {cell && (
        <div className="flex">
          <span className="w-9 shrink-0 pr-2 text-right text-faint tabular-nums select-none">
            {cell.no}
          </span>
          {marker && (
            <span
              className={cn(
                "w-3 shrink-0 select-none",
                tone === "removed" ? "text-danger" : "text-success",
              )}
              aria-hidden="true"
            >
              {marker}
            </span>
          )}
          <span className="selectable min-w-0 flex-1 pr-3 break-words whitespace-pre-wrap text-text">
            {marker && <span className="sr-only">{t("conflicts.onlyHere")}</span>}
            {cell.text || " "}
          </span>
        </div>
      )}
    </td>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center font-sans text-sm text-muted-text">{children}</p>;
}
