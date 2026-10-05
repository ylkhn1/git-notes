import { useBackClose } from "@/lib/back-stack";
import { formatBytes } from "@/lib/format";
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
  useBackClose(open, close);
  if (!info) return null;

  const date = info.date ? new Date(info.date) : null;
  const released =
    date && !Number.isNaN(date.getTime())
      ? `Released ${date.toLocaleDateString(undefined, { dateStyle: "medium" })}.`
      : "A new version is available.";
  const fraction = total ? Math.min(1, downloaded / total) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>git-notes {info.version}</DialogTitle>
          <DialogDescription>
            {released} You have {info.currentVersion}.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          {info.notes ? (
            <pre className="max-h-64 overflow-auto rounded-md border border-line bg-surface p-3 font-sans text-xs whitespace-pre-wrap text-text">
              {info.notes}
            </pre>
          ) : (
            <p className="text-sm text-muted-text">No release notes for this version.</p>
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
                {formatBytes(downloaded)}
                {total !== null && ` of ${formatBytes(total)}`}
              </p>
            </div>
          )}
          {phase === "installed" && (
            <p className="text-sm text-success" role="status">
              Installed. Open notes are saved before the restart.
            </p>
          )}
          {phase === "error" && errorStep === "install" && (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              <p>{error}</p>
              <p className="text-text">
                You can download this version from{" "}
                <span className="selectable font-mono">{RELEASES_URL}</span>
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Later
          </Button>
          {phase === "installed" ? (
            <Button onClick={() => void restart()}>Restart now</Button>
          ) : (
            <Button disabled={phase === "downloading"} onClick={() => void install()}>
              {phase === "downloading"
                ? "Downloading…"
                : phase === "error"
                  ? "Try again"
                  : "Install"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
