import { ArrowLeft, Check, Copy, ExternalLink, FileWarning, Files } from "lucide-react";
import { useEffect, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import {
  commands,
  type ConflictInfo,
  type ConflictResolution,
  type FileDiff,
} from "@/lib/bindings";
import { useT } from "@/lib/i18n";
import { displayTitle } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { errorMessage, unwrap } from "@/lib/result";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";

import { useEditorStore } from "@/features/editor/store";
import { useNotebooksStore } from "@/features/notebooks/store";
import { useSyncStore } from "@/features/sync/store";

import { formatStamp, useConflictsDialog } from "./dialog-store";
import { SideBySideDiff } from "./SideBySideDiff";
import { alignRows, countChanges } from "./side-by-side";

/** Lists conflict copies and compares each with the current note, side by side. */
export function ConflictsDialog() {
  const open = useConflictsDialog((s) => s.open);
  const initialCopy = useConflictsDialog((s) => s.initialCopy);
  const hide = useConflictsDialog((s) => s.hide);
  const notebook = useNotebooksStore((s) => s.current);
  const t = useT();
  useBackClose(open, hide);
  if (!notebook) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : hide())}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "h-full max-h-full w-full max-w-full rounded-none" : "h-[82vh] sm:max-w-5xl",
        )}
      >
        <DialogHeader className="border-b border-line px-5 py-3">
          <DialogTitle>{t("conflicts.title")}</DialogTitle>
          <DialogDescription>{t("conflicts.description")}</DialogDescription>
        </DialogHeader>
        {open && <ConflictsBody notebookId={notebook.id} initialCopy={initialCopy} />}
      </DialogContent>
    </Dialog>
  );
}

function ConflictsBody({
  notebookId,
  initialCopy,
}: {
  notebookId: string;
  initialCopy: string | null;
}) {
  const t = useT();
  const conflicts = useSyncStore((s) => s.conflicts);
  const [selectedCopy, setSelectedCopy] = useState<string | null>(
    initialCopy ?? conflicts[0]?.copy ?? null,
  );
  const [mobileStep, setMobileStep] = useState<"list" | "detail">(initialCopy ? "detail" : "list");

  // Follow the list when the selected copy disappears (resolved here or synced away).
  const selected =
    conflicts.find((c) => c.copy === selectedCopy) ??
    (selectedCopy === null ? undefined : conflicts[0]);

  const select = (conflict: ConflictInfo) => {
    setSelectedCopy(conflict.copy);
    setMobileStep("detail");
  };

  if (conflicts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-text">
        <Check className="size-8 text-success" aria-hidden="true" />
        <p className="text-sm text-text">{t("conflicts.noneLeft")}</p>
        <p className="text-sm">{t("conflicts.allResolved")}</p>
      </div>
    );
  }

  const list = (
    <ul className="min-h-0 flex-1 divide-y divide-line overflow-x-hidden overflow-y-auto">
      {conflicts.map((c) => (
        <li key={c.copy}>
          <button
            type="button"
            onClick={() => select(c)}
            aria-current={selected?.copy === c.copy ? "true" : undefined}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
              isMobile && "min-h-12",
              selected?.copy === c.copy && "bg-accent-soft",
            )}
          >
            <span className="flex w-full items-center gap-1.5 text-sm">
              <FileWarning className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span className="truncate">{displayTitle(c.original)}</span>
            </span>
            <span className="w-full truncate text-xs text-faint">
              {t("conflicts.fromDevice", { device: c.device })} · {formatStamp(c.stamp)}
              {c.original.includes("/") ? ` · ${c.original}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  const detail = selected ? (
    <ConflictDetail key={selected.copy} notebookId={notebookId} conflict={selected} />
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-text">
      <Files className="size-8 text-faint" aria-hidden="true" />
      <p className="text-sm">{t("conflicts.selectCopyHint")}</p>
    </div>
  );

  if (isMobile) {
    return mobileStep === "list" || !selected ? (
      <div className="flex min-h-0 flex-1 flex-col">{list}</div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-1">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t("conflicts.backToList")}
            onClick={() => setMobileStep("list")}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <span className="truncate text-sm">{displayTitle(selected.original)}</span>
        </div>
        {detail}
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
      <div className="flex min-h-0 flex-col border-r border-line">{list}</div>
      <div className="flex min-h-0 flex-col">{detail}</div>
    </div>
  );
}

type Loading<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

function ConflictDetail({ notebookId, conflict }: { notebookId: string; conflict: ConflictInfo }) {
  const t = useT();
  const [diff, setDiff] = useState<Loading<FileDiff>>({ status: "loading" });
  const [busy, setBusy] = useState<ConflictResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolve = useSyncStore((s) => s.resolveConflict);
  const hide = useConflictsDialog((s) => s.hide);

  useEffect(() => {
    let cancelled = false;
    unwrap(commands.getConflictDiff(notebookId, conflict.copy))
      .then((data) => {
        if (!cancelled) setDiff({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) setDiff({ status: "error", message: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, conflict.copy]);

  const apply = async (resolution: ConflictResolution) => {
    setBusy(resolution);
    setError(null);
    try {
      await resolve(conflict.copy, resolution);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const openInEditor = () => {
    const editor = useEditorStore.getState();
    const paths = isMobile
      ? [conflict.copy]
      : [conflict.copy, ...(conflict.originalExists ? [conflict.original] : [])];
    void (async () => {
      for (const path of paths) await editor.open(notebookId, path);
    })();
    hide();
  };

  const changes = diff.status === "ready" ? countChanges(alignRows(diff.data)) : null;
  const leftLabel = conflict.originalExists
    ? t("conflicts.currentLabel", { title: displayTitle(conflict.original) })
    : t("conflicts.currentDeletedLabel");
  const rightLabel = t("conflicts.copyLabel", {
    device: conflict.device,
    stamp: formatStamp(conflict.stamp),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-2 text-xs text-muted-text">
        <div className="truncate text-sm text-text">{conflict.original}</div>
        <div className={isMobile ? "line-clamp-2" : "truncate"}>
          {conflict.originalExists
            ? t("conflicts.comparingCurrent", {
                device: conflict.device,
                stamp: formatStamp(conflict.stamp),
              })
            : t("conflicts.comparingDeleted", { device: conflict.device })}
          {changes !== null && ` · ${t("conflicts.linesDiffer", { count: changes })}`}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {diff.status === "loading" && (
          <div
            className="space-y-2 p-4"
            aria-busy="true"
            aria-label={t("conflicts.loadingComparison")}
          >
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        )}
        {diff.status === "error" && (
          <p role="alert" className="p-4 text-sm text-danger">
            {diff.message}
          </p>
        )}
        {diff.status === "ready" && (
          <SideBySideDiff
            diff={diff.data}
            layout={isMobile ? "stacked" : "split"}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-surface p-3">
        {error && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className={cn("flex flex-wrap gap-2", isMobile && "[&>button]:min-h-11")}>
          <Button
            variant="outline"
            size={isMobile ? "lg" : "default"}
            disabled={busy !== null || !conflict.originalExists}
            onClick={() => void apply("keepCurrent")}
          >
            <Check data-icon="inline-start" /> {t("conflicts.keepCurrent")}
          </Button>
          <Button
            variant="outline"
            size={isMobile ? "lg" : "default"}
            disabled={busy !== null}
            onClick={() => void apply("useCopy")}
          >
            <Copy data-icon="inline-start" /> {t("conflicts.useCopy")}
          </Button>
          <Button
            variant="outline"
            size={isMobile ? "lg" : "default"}
            disabled={busy !== null}
            onClick={() => void apply("keepBoth")}
          >
            <Files data-icon="inline-start" /> {t("conflicts.keepBoth")}
          </Button>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size={isMobile ? "lg" : "default"}
            disabled={busy !== null}
            onClick={openInEditor}
          >
            <ExternalLink data-icon="inline-start" /> {t("conflicts.openInEditor")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-faint">
          {t("conflicts.resolutionHint", {
            title: displayTitle(conflict.original),
            device: conflict.device,
          })}
        </p>
      </div>
    </div>
  );
}
