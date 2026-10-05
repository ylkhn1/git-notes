import { useBackClose } from "@/lib/back-stack";
import { formatBytes } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";

import { useUiStore } from "@/features/shell/ui-store";

import { RELEASES_URL, useUpdateStore } from "./store";

/** Release notes and the install / restart actions for the announced update. */
export function UpdateDialog() {
  const open = useUiStore((s) => s.dialog === "update");
  const close = useUiStore((s) => s.closeDialog);
  const phase = useUpdateStore((s) => s.phase);
  const info = useUpdateStore((s) => s.info);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const total = useUpdateStore((s) => s.total);
  const error = useUpdateStore((s) => s.error);
  const errorStep = useUpdateStore((s) => s.errorStep);
  const install = useUpdateStore((s) => s.install);
  const restart = useUpdateStore((s) => s.restart);
  const t = useT();
  const locale = useLocale();
  useBackClose(open, close);
  if (!info) return null;

  const date = info.date ? new Date(info.date) : null;
  const released =
    date && !Number.isNaN(date.getTime())
      ? t("updates.released", { date: date.toLocaleDateString(locale, { dateStyle: "medium" }) })
      : t("updates.newVersionAvailable");
  const fraction = total ? Math.min(1, downloaded / total) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>git-notes {info.version}</DialogTitle>
          <DialogDescription>
            {released} {t("updates.youHave", { version: info.currentVersion })}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          {info.notes ? (
            <pre className="max-h-64 overflow-auto rounded-md border border-line bg-surface p-3 font-sans text-xs whitespace-pre-wrap text-text">
              {info.notes}
            </pre>
          ) : (
            <p className="text-sm text-muted-text">{t("updates.noReleaseNotes")}</p>
          )}
          {phase === "downloading" && (
            <div className="space-y-1" aria-live="polite">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
              >
                <div
                  className={
                    fraction === null
                      ? "h-full w-1/3 animate-pulse bg-accent"
                      : "h-full bg-accent transition-[width]"
                  }
                  style={
                    fraction === null
                      ? undefined
                      : { width: `${String(Math.round(fraction * 100))}%` }
                  }
                />
              </div>
              <p className="text-xs text-muted-text">
                {total === null
                  ? formatBytes(downloaded)
                  : t("updates.progress", {
                      done: formatBytes(downloaded),
                      total: formatBytes(total),
                    })}
              </p>
            </div>
          )}
          {phase === "installed" && (
            <p className="text-sm text-success" role="status">
              {t("updates.installedHint")}
            </p>
          )}
          {phase === "error" && errorStep === "install" && (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              <p>{error}</p>
              <p className="text-text">
                {rich(
                  "updates.downloadFrom",
                  { link: (text) => <span className="selectable font-mono">{text}</span> },
                  { url: RELEASES_URL },
                )}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("common.later")}
          </Button>
          {phase === "installed" ? (
            <Button onClick={() => void restart()}>{t("updates.restartNow")}</Button>
          ) : (
            <Button disabled={phase === "downloading"} onClick={() => void install()}>
              {phase === "downloading"
                ? t("updates.downloading")
                : phase === "error"
                  ? t("common.tryAgain")
                  : t("common.install")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
