import { ChevronsUpDown, FilePlus, FolderPlus, Menu, X } from "lucide-react";
import { useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import { parentOf } from "@/lib/paths";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/ui/sheet";

import { Editor } from "@/features/editor/Editor";
import { FormattingToolbar } from "@/features/editor/FormattingToolbar";
import { selectActiveTab, useEditorStore } from "@/features/editor/store";
import { NewNotebookDialog } from "@/features/notebooks/NewNotebookDialog";
import { useNotebooksStore } from "@/features/notebooks/store";
import { ViewMenu } from "@/features/settings/ViewMenu";
import { useTreeDialogStore } from "@/features/tree/dialog-store";
import { FileTree } from "@/features/tree/FileTree";
import { findNode, useTreeStore } from "@/features/tree/store";

/** Single-pane layout for phones: app bar, editor, formatting toolbar, notes in a drawer. */
export function MobileShell() {
  const notebook = useNotebooksStore((s) => s.current);
  const notebooks = useNotebooksStore((s) => s.notebooks);
  const tab = useEditorStore(selectActiveTab);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newNotebookOpen, setNewNotebookOpen] = useState(false);
  const openDialog = useTreeDialogStore((s) => s.open);
  useBackClose(drawerOpen, () => setDrawerOpen(false));

  if (!notebook) return null;

  const selectedDir = () => {
    const tree = useTreeStore.getState();
    const node = tree.selectedPath ? findNode(tree.nodes, tree.selectedPath) : undefined;
    return node ? (node.kind === "dir" ? node.path : parentOf(node.path)) : "";
  };

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface px-1">
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Open notes"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-base font-medium">{tab ? tab.title : notebook.name}</div>
          {tab && <div className="truncate text-2xs text-muted-text">{notebook.name}</div>}
        </div>
        <ViewMenu />
      </header>

      <div className="min-h-0 flex-1">
        {tab ? (
          <Editor key={tab.path} tab={tab} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm text-muted-text">
              Open a note from the list or create a new one.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="lg" onClick={() => setDrawerOpen(true)}>
                <Menu data-icon="inline-start" /> Notes
              </Button>
              <Button size="lg" onClick={() => openDialog({ kind: "new-note", dir: "" })}>
                <FilePlus data-icon="inline-start" /> New note
              </Button>
            </div>
          </div>
        )}
      </div>
      {tab && <FormattingToolbar />}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="flex w-[86vw] max-w-sm flex-col gap-0 p-0"
        >
          <SheetTitle className="sr-only">Notes</SheetTitle>
          <SheetDescription className="sr-only">Notebook switcher and file tree</SheetDescription>
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="lg"
                  className="min-w-0 flex-1 justify-start gap-1.5 px-2 text-base font-medium"
                >
                  <span className="truncate">{notebook.name}</span>
                  <ChevronsUpDown className="size-4 shrink-0 text-faint" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Notebooks</DropdownMenuLabel>
                {notebooks.map((nb) => (
                  <DropdownMenuItem
                    key={nb.id}
                    className="h-11"
                    onSelect={() => {
                      void useNotebooksStore.getState().select(nb.id);
                    }}
                  >
                    {nb.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-11" onSelect={() => setNewNotebookOpen(true)}>
                  <FolderPlus /> New notebook…
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-11"
                  onSelect={() => {
                    setDrawerOpen(false);
                    void useNotebooksStore.getState().closeCurrent();
                  }}
                >
                  <X /> Close notebook
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="New note"
              onClick={() => openDialog({ kind: "new-note", dir: selectedDir() })}
            >
              <FilePlus className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="New folder"
              onClick={() => openDialog({ kind: "new-folder", dir: selectedDir() })}
            >
              <FolderPlus className="size-5" />
            </Button>
          </div>
          <FileTree notebookId={notebook.id} mobile onOpenFile={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>
      <NewNotebookDialog open={newNotebookOpen} onOpenChange={setNewNotebookOpen} />
    </div>
  );
}
