import type { FileDiff } from "@/lib/bindings";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Unified diff of one file in one commit. */
export function DiffView({ diff }: { diff: FileDiff }) {
  const t = useT();
  if (diff.binary) {
    return <Empty>{t("history.binaryFile", { kind: diff.kind })}</Empty>;
  }
  if (diff.hunks.length === 0) {
    return (
      <Empty>
        {diff.kind === "renamed" ? t("history.renamedOnly") : t("history.noTextualChanges")}
      </Empty>
    );
  }
  return (
    <div className="overflow-x-auto font-mono text-xs leading-5">
      {diff.hunks.map((hunk, i) => (
        <div key={i} className="mb-3 last:mb-0">
          <div className="sticky top-0 bg-surface-2 px-3 py-1 text-faint">{hunk.header}</div>
          <table className="w-full border-collapse">
            <tbody>
              {hunk.lines.map((line, j) => (
                <tr
                  key={j}
                  className={cn(
                    line.kind === "add" && "bg-success/10",
                    line.kind === "delete" && "bg-danger/10",
                  )}
                >
                  <td className="w-10 pr-2 text-right align-top text-faint tabular-nums select-none">
                    {line.oldNo ?? ""}
                  </td>
                  <td className="w-10 pr-2 text-right align-top text-faint tabular-nums select-none">
                    {line.newNo ?? ""}
                  </td>
                  <td
                    className={cn(
                      "w-4 pr-1 align-top select-none",
                      line.kind === "add" && "text-success",
                      line.kind === "delete" && "text-danger",
                    )}
                    aria-hidden="true"
                  >
                    {line.kind === "add" ? "+" : line.kind === "delete" ? "−" : " "}
                  </td>
                  <td className="selectable pr-3 align-top break-all whitespace-pre-wrap text-text">
                    <span className="sr-only">
                      {line.kind === "add"
                        ? t("history.addedLine")
                        : line.kind === "delete"
                          ? t("history.removedLine")
                          : ""}
                    </span>
                    {line.text || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-sm text-muted-text">{children}</p>;
}
