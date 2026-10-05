import { Download, X } from "lucide-react";

import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
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
  const t = useT();
  if (isMobile || !visible || !info) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-accent-soft px-4 py-1.5 text-sm text-text"
    >
      <Download className="size-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {phase === "available" &&
          rich(
            "updates.available",
            { b: (text) => <strong>{text}</strong> },
            {
              version: info.version,
            },
          )}
        {phase === "downloading" && (
          <>
            {t("updates.downloadingVersion", { version: info.version })} {formatBytes(downloaded)}
            {total !== null && ` / ${formatBytes(total)}`}
          </>
        )}
        {phase === "installed" &&
          rich(
            "updates.installed",
            { b: (text) => <strong>{text}</strong> },
            {
              version: info.version,
            },
          )}
        {phase === "error" &&
          t("updates.installFailed", { error: error ?? t("common.unknownError") })}
      </span>
      {phase === "available" && (
        <>
          <Button size="xs" variant="ghost" onClick={() => openDialog("update")}>
            {t("updates.whatsNew")}
          </Button>
          <Button size="xs" onClick={() => void install()}>
            {t("common.install")}
          </Button>
        </>
      )}
      {phase === "installed" && (
        <Button size="xs" onClick={() => void restart()}>
          {t("updates.restartNow")}
        </Button>
      )}
      {phase === "error" && (
        <Button size="xs" variant="outline" onClick={() => openDialog("update")}>
          {t("updates.details")}
        </Button>
      )}
      {phase !== "downloading" && (
        <Button size="xs" variant="ghost" aria-label={t("common.dismiss")} onClick={dismiss}>
          <X />
        </Button>
      )}
    </div>
  );
}
