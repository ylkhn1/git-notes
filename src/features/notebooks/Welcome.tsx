import { CloudDownload, FolderOpen, GitBranch, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";

import { useT } from "@/lib/i18n";
import { isAndroid } from "@/lib/platform";
import { errorMessage } from "@/lib/result";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

import { ViewMenu } from "@/features/settings/ViewMenu";
import { SharePendingNotice } from "@/features/share/ShareImport";
import { useUiStore } from "@/features/shell/ui-store";
import { UpdateBanner } from "@/features/updates/UpdateBanner";

import { useNotebooksStore } from "./store";

/** Shown when no notebook is open: create, open a folder, or pick a known notebook. */
export function Welcome() {
  const t = useT();
  const notebooks = useNotebooksStore((s) => s.notebooks);
  const status = useNotebooksStore((s) => s.status);
  const loadError = useNotebooksStore((s) => s.error);
  const openDialog = useUiStore((s) => s.openDialog);
  const [error, setError] = useState<string | null>(null);

  const openFolder = () => {
    setError(null);
    useNotebooksStore
      .getState()
      .openFolder()
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <main data-tauri-drag-region className="flex h-full flex-col overflow-y-auto">
      <UpdateBanner />
      <div data-tauri-drag-region className="flex shrink-0 justify-end p-2">
        <ViewMenu />
      </div>
      <div
        data-tauri-drag-region
        className="flex flex-1 flex-col items-center justify-center px-8 pb-8"
      >
        <div className="w-full max-w-md space-y-8">
          <header className="space-y-2 text-center">
            <GitBranch className="mx-auto size-9 text-accent" aria-hidden="true" />
            <h1 className="text-xl font-semibold tracking-tight">git-notes</h1>
            <p className="text-sm text-muted-text">{t("notebooks.tagline")}</p>
          </header>

          <SharePendingNotice />

          <div className={isAndroid ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
            <Button size="lg" onClick={() => openDialog("newNotebook")}>
              <Plus data-icon="inline-start" /> {t("notebooks.newNotebook")}
            </Button>
            <Button size="lg" variant="outline" onClick={() => openDialog("clone")}>
              <CloudDownload data-icon="inline-start" /> {t("notebooks.cloneRepository")}
            </Button>
            {!isAndroid && (
              <Button size="lg" variant="outline" className="sm:col-span-2" onClick={openFolder}>
                <FolderOpen data-icon="inline-start" /> {t("notebooks.openFolder")}
              </Button>
            )}
          </div>

          {(error ?? loadError) && (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error ?? loadError}
            </p>
          )}

          {status === "loading" && (
            <div
              className="space-y-2"
              aria-busy="true"
              aria-label={t("notebooks.loadingNotebooks")}
            >
              <div className="h-9 animate-pulse rounded-md bg-surface-2" />
              <div className="h-9 animate-pulse rounded-md bg-surface-2" />
            </div>
          )}

          {notebooks.length > 0 && (
            <section className="space-y-1">
              <h2 className="px-1 text-xs font-medium tracking-wide text-muted-text uppercase">
                {t("notebooks.recent")}
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
                {notebooks.map((nb) => (
                  <li key={nb.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        useNotebooksStore
                          .getState()
                          .select(nb.id)
                          .catch((e: unknown) => setError(errorMessage(e)));
                      }}
                      className="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
                    >
                      <span className="text-sm font-medium">{nb.name}</span>
                      <span className="max-w-full truncate text-xs text-faint">{nb.path}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="mr-1"
                          aria-label={t("notebooks.optionsFor", { name: nb.name })}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            void useNotebooksStore.getState().forget(nb.id);
                          }}
                        >
                          {t("notebooks.removeFromList")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
              <p className="px-1 text-xs text-faint">{t("notebooks.removeHint")}</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
