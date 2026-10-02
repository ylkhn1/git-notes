import { FileText, Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { useBackClose } from "@/lib/back-stack";
import { parentOf } from "@/lib/paths";
import { Button } from "@/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/ui/sheet";

import { useEditorStore } from "@/features/editor/store";

import { useTreeDialogStore } from "./dialog-store";
import { ConfirmDeleteDialog, MoveDialog, NameDialog } from "./dialogs";
import { findNode, useTreeStore } from "./store";
import { collectFolders, validateName } from "./validation";

interface TreeDialogsProps {
  notebookId: string;
  /** Called after a note is created so the shell can open it. */
  onNoteCreated: (path: string) => void;
}

/** All create / rename / move / delete dialogs plus the mobile action sheet, driven by the dialog store. */
export function TreeDialogs({ notebookId: _notebookId, onNoteCreated }: TreeDialogsProps) {
  const dialog = useTreeDialogStore((s) => s.dialog);
  const open = useTreeDialogStore((s) => s.open);
  const close = useTreeDialogStore((s) => s.close);
  const nodes = useTreeStore((s) => s.nodes);
  const folders = useMemo(() => collectFolders(nodes), [nodes]);
  const closeIf = (isOpen: boolean) => {
    if (!isOpen) close();
  };
  useBackClose(dialog.kind !== "none", close);

  const actionNode = dialog.kind === "actions" ? findNode(nodes, dialog.path) : undefined;
  const actionDir = actionNode
    ? actionNode.kind === "dir"
      ? actionNode.path
      : parentOf(actionNode.path)
    : "";

  return (
    <>
      <NameDialog
        open={dialog.kind === "new-note"}
        title="New note"
        label="Name"
        description={dialog.kind === "new-note" && dialog.dir ? `In ${dialog.dir}` : undefined}
        initialValue="Untitled.md"
        validate={validateName}
        onSubmit={async (name) => {
          if (dialog.kind !== "new-note") return;
          const path = await useTreeStore.getState().createNote(dialog.dir, name);
          onNoteCreated(path);
        }}
        onOpenChange={closeIf}
      />
      <NameDialog
        open={dialog.kind === "new-folder"}
        title="New folder"
        label="Name"
        description={dialog.kind === "new-folder" && dialog.dir ? `In ${dialog.dir}` : undefined}
        validate={validateName}
        onSubmit={async (name) => {
          if (dialog.kind !== "new-folder") return;
          await useTreeStore.getState().createFolder(dialog.dir, name);
        }}
        onOpenChange={closeIf}
      />
      <NameDialog
        open={dialog.kind === "rename"}
        title="Rename"
        label="New name"
        submitLabel="Rename"
        initialValue={dialog.kind === "rename" ? (dialog.path.split("/").pop() ?? "") : ""}
        validate={validateName}
        onSubmit={async (name) => {
          if (dialog.kind !== "rename") return;
          const from = dialog.path;
          const to = await useTreeStore.getState().rename(from, name);
          useEditorStore.getState().renamed(from, to);
        }}
        onOpenChange={closeIf}
      />
      <MoveDialog
        open={dialog.kind === "move"}
        path={dialog.kind === "move" ? dialog.path : null}
        folders={folders}
        onMove={async (toDir) => {
          if (dialog.kind !== "move") return;
          const from = dialog.path;
          const to = await useTreeStore.getState().move(from, toDir);
          useEditorStore.getState().renamed(from, to);
        }}
        onOpenChange={closeIf}
      />
      <ConfirmDeleteDialog
        open={dialog.kind === "delete"}
        path={dialog.kind === "delete" ? dialog.path : null}
        isDir={dialog.kind === "delete" && findNode(nodes, dialog.path)?.kind === "dir"}
        onConfirm={async () => {
          if (dialog.kind !== "delete") return;
          const path = dialog.path;
          useEditorStore.getState().removed(path);
          await useTreeStore.getState().remove(path);
        }}
        onOpenChange={closeIf}
      />

      {/* Mobile: bottom sheet instead of a context menu. */}
      <Sheet open={dialog.kind === "actions"} onOpenChange={closeIf}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="pb-1">
            <SheetTitle className="truncate">{actionNode?.name ?? ""}</SheetTitle>
            <SheetDescription>{actionNode?.kind === "dir" ? "Folder" : "Note"}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-1">
            <SheetAction
              icon={FileText}
              label={actionNode?.kind === "dir" ? "New note inside" : "New note here"}
              onClick={() => open({ kind: "new-note", dir: actionDir })}
            />
            <SheetAction
              icon={FolderPlus}
              label={actionNode?.kind === "dir" ? "New folder inside" : "New folder here"}
              onClick={() => open({ kind: "new-folder", dir: actionDir })}
            />
            {actionNode && (
              <SheetAction
                icon={Pencil}
                label="Rename"
                onClick={() => open({ kind: "rename", path: actionNode.path })}
              />
            )}
            {actionNode && (
              <SheetAction
                icon={Folder}
                label="Move to…"
                onClick={() => open({ kind: "move", path: actionNode.path })}
              />
            )}
            {actionNode && (
              <SheetAction
                icon={Trash2}
                label="Delete"
                destructive
                onClick={() => open({ kind: "delete", path: actionNode.path })}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SheetAction({
  icon: Icon,
  label,
  destructive,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="lg"
      onClick={onClick}
      className={`h-12 justify-start gap-3 px-3 text-base ${destructive ? "text-danger hover:text-danger" : ""}`}
    >
      <Icon className="size-5" /> {label}
    </Button>
  );
}
