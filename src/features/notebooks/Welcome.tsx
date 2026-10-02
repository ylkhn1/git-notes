import { FolderOpen, GitBranch, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";

import { errorMessage } from "@/lib/result";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

import { ViewMenu } from "@/features/settings/ViewMenu";

import { NewNotebookDialog } from "./NewNotebookDialog";
import { useNotebooksStore } from "./store";

/** Shown when no notebook is open: create, open a folder, or pick a known notebook. */
export function Welcome() {
  const notebooks = useNotebooksStore((s) => s.notebooks);
  const status = useNotebooksStore((s) => s.status);
  const loadError = useNotebooksStore((s) => s.error);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFolder = () => {
    setError(null);
    useNotebooksStore
      .getState()
      .openFolder()
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <main
      data-tauri-drag-region
      className="relative flex h-full flex-col items-center justify-center p-8"
    >
      <div className="absolute top-2 right-2">
        <ViewMenu />
      </div>
      <div className="w-full max-w-md space-y-8">
        <header className="space-y-2 text-center">
          <GitBranch className="mx-auto size-9 text-accent" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-tight">git-notes</h1>
          <p className="text-sm text-muted-text">
            Plain Markdown files in a folder. Soon: synced with git on every device.
          </p>
        </header>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" /> New notebook
          </Button>
          <Button size="lg" variant="outline" onClick={openFolder}>
            <FolderOpen data-icon="inline-start" /> Open folder
          </Button>
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
          <div className="space-y-2" aria-busy="true" aria-label="Loading notebooks">
            <div className="h-9 animate-pulse rounded-md bg-surface-2" />
            <div className="h-9 animate-pulse rounded-md bg-surface-2" />
          </div>
        )}

        {notebooks.length > 0 && (
          <section className="space-y-1">
            <h2 className="px-1 text-xs font-medium tracking-wide text-muted-text uppercase">
              Recent
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
                        aria-label={`Options for ${nb.name}`}
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
                        Remove from list
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
            <p className="px-1 text-xs text-faint">
              Removing a notebook from the list keeps its files on disk.
            </p>
          </section>
        )}
      </div>
      <NewNotebookDialog open={creating} onOpenChange={setCreating} />
    </main>
  );
}
