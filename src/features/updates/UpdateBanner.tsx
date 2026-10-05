import { Download, X } from "lucide-react";

import { formatBytes } from "@/lib/format";
import { isMobile } from "@/lib/platform";
import { Button } from "@/ui/button";

import { useUiStore } from "@/features/shell/ui-store";

import { selectBannerVisible, useUpdateStore } from "./store";

/** One-line notice about an available, downloading, installed or failed update (desktop). */
export function UpdateBanner() {
  const visible = useUpdateStore(selectBannerVisible);
  const phase = useUpdateStore((s) => s.phase);
  const info = useUpdateStore((s) => s.info);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const total = useUpdateStore((s) => s.total);
  const error = useUpdateStore((s) => s.error);
  const install = useUpdateStore((s) => s.install);
  const restart = useUpdateStore((s) => s.restart);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const openDialog = useUiStore((s) => s.openDialog);
  if (isMobile || !visible || !info) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-accent-soft px-4 py-1.5 text-sm text-text"
    >
      <Download className="size-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {phase === "available" && (
          <>
            <strong>git-notes {info.version}</strong> is available.
          </>
        )}
        {phase === "downloading" && (
          <>
            Downloading git-notes {info.version}… {formatBytes(downloaded)}
            {total !== null && ` / ${formatBytes(total)}`}
          </>
        )}
        {phase === "installed" && (
          <>
            <strong>git-notes {info.version}</strong> is installed. Restart to finish.
          </>
        )}
        {phase === "error" && <>Could not install the update: {error}</>}
      </span>
      {phase === "available" && (
        <>
          <Button size="xs" variant="ghost" onClick={() => openDialog("update")}>
            What’s new
          </Button>
          <Button size="xs" onClick={() => void install()}>
            Install
          </Button>
        </>
      )}
      {phase === "installed" && (
        <Button size="xs" onClick={() => void restart()}>
          Restart now
        </Button>
      )}
      {phase === "error" && (
        <Button size="xs" variant="outline" onClick={() => openDialog("update")}>
          Details
        </Button>
      )}
      {phase !== "downloading" && (
        <Button size="xs" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
          <X />
        </Button>
      )}
    </div>
  );
}
