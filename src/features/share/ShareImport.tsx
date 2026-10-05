import { Share2, X } from "lucide-react";
import { useEffect } from "react";

import { useT } from "@/lib/i18n";
import { Button } from "@/ui/button";

import { useNotebooksStore } from "@/features/notebooks/store";

import { useShareStore } from "./store";

/**
 * Headless: picks up text shared from other apps and saves it into the open notebook.
 * While no notebook is open the text waits (see {@link SharePendingNotice}).
 */
export function ShareImport() {
  const pending = useShareStore((s) => s.pending);
  const notebook = useNotebooksStore((s) => s.current);

  useEffect(() => {
    const poll = () => {
      void useShareStore.getState().poll();
    };
    poll();
    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (pending && notebook) void useShareStore.getState().saveInto(notebook.id);
  }, [pending, notebook]);

  return null;
}

/** Shown on the notebook list while shared text waits for a notebook to be opened. */
export function SharePendingNotice() {
  const t = useT();
  const pending = useShareStore((s) => s.pending);
  const error = useShareStore((s) => s.error);
  const discard = useShareStore((s) => s.discard);
  if (!pending) return null;
  const preview = (pending.title ?? pending.text).trim().split("\n")[0] ?? "";

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm"
    >
      <Share2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("share.waiting")}</p>
        <p className="truncate text-xs text-muted-text">{preview}</p>
        <p className="text-xs text-muted-text">{t("share.waitingHint")}</p>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={t("share.discard")} onClick={discard}>
        <X />
      </Button>
    </div>
  );
}
