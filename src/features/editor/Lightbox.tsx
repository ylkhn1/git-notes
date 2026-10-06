import { ExternalLink, X } from "lucide-react";

import { notebookAssetUrl } from "@/lib/asset-url";
import { useBackClose } from "@/lib/back-stack";
import { commands } from "@/lib/bindings";
import { useT } from "@/lib/i18n";
import { baseName } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { errorMessage, unwrap } from "@/lib/result";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";

import { notify } from "@/features/shell/notice";

import { useLightbox } from "./lightbox-store";

export function Lightbox() {
  const t = useT();
  const image = useLightbox((s) => s.image);
  const hide = useLightbox((s) => s.hide);
  useBackClose(image !== null, hide);
  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && hide()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 border-none bg-black/90 p-0 sm:max-w-[96vw]"
      >
        <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-white">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-normal text-white">
            {image ? baseName(image.path) : ""}
          </DialogTitle>
          <DialogDescription className="sr-only">{image?.path}</DialogDescription>
          {image && !isMobile && (
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                unwrap(commands.openNotebookFile(image.notebookId, image.path)).catch(
                  (e: unknown) => {
                    notify(errorMessage(e), "error");
                  },
                );
              }}
            >
              <ExternalLink data-icon="inline-start" /> {t("editor.openWithSystem")}
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            aria-label={t("common.close")}
            onClick={hide}
          >
            <X />
          </Button>
        </div>
        {image && (
          <button
            type="button"
            className="flex min-h-0 flex-1 items-center justify-center p-2"
            onClick={hide}
            aria-label={t("common.close")}
          >
            <img
              src={notebookAssetUrl(image.notebookId, image.path)}
              alt={baseName(image.path)}
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
