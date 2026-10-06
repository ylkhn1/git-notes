import { X } from "lucide-react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { useNoticeStore } from "./notice";

export function NoticeHost() {
  const t = useT();
  const notice = useNoticeStore((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-10 z-50 flex justify-center px-4">
      <div
        role={notice.tone === "error" ? "alert" : "status"}
        className={cn(
          "pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border bg-surface px-3 py-2 text-sm shadow-lg",
          notice.tone === "error" ? "border-danger/40 text-danger" : "border-line text-text",
        )}
      >
        <span className="min-w-0 flex-1 break-words">{notice.text}</span>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => useNoticeStore.getState().dismiss()}
          className="shrink-0 rounded p-0.5 text-faint hover:text-text"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
