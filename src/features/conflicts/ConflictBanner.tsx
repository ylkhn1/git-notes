import { AlertTriangle, X } from "lucide-react";
import { useMemo } from "react";

import { useT } from "@/lib/i18n";
import { displayTitle } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";

import { selectVisibleConflicts, useSyncStore } from "@/features/sync/store";

import { useConflictsDialog } from "./dialog-store";

/** Slim bar above the editor while conflict copies wait for a decision. */
export function ConflictBanner() {
  // Select the two arrays separately: a filtering selector would return a fresh array on
  // every read, which zustand (useSyncExternalStore) treats as an endless change.
  const all = useSyncStore((s) => s.conflicts);
  const dismissed = useSyncStore((s) => s.dismissedConflicts);
  const conflicts = useMemo(
    () => selectVisibleConflicts({ conflicts: all, dismissedConflicts: dismissed }),
    [all, dismissed],
  );
  const dismiss = useSyncStore((s) => s.dismissConflicts);
  const show = useConflictsDialog((s) => s.show);
  const t = useT();
  if (conflicts.length === 0) return null;

  const n = conflicts.length;
  const first = conflicts[0];
  const summary =
    n === 1 && first
      ? t("conflicts.noteChangedOnTwoDevices", { title: displayTitle(first.original) })
      : t("conflicts.notesChangedOnTwoDevices", { count: n });

  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 pr-1 pl-3 text-sm",
        isMobile ? "min-h-12" : "min-h-9",
      )}
    >
      <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0 flex-1 py-1.5">
        <span className="font-medium">{t("conflicts.copiesToReview", { count: n })}</span>{" "}
        <span className="text-muted-text">
          {summary}
          {!isMobile && ` ${t("conflicts.bothVersionsKept")}`}
        </span>
      </div>
      <Button
        variant="outline"
        size={isMobile ? "default" : "sm"}
        className="shrink-0 bg-bg"
        onClick={() => show(first?.copy)}
      >
        {t("conflicts.review")}
      </Button>
      <Button
        variant="ghost"
        size={isMobile ? "icon-lg" : "icon-sm"}
        className="shrink-0"
        aria-label={t("conflicts.dismissForNow")}
        onClick={dismiss}
      >
        <X />
      </Button>
    </div>
  );
}
