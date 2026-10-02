import {
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Pencil,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { TreeNode } from "@/lib/bindings";
import { isMarkdown, parentOf } from "@/lib/paths";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { ScrollArea } from "@/ui/scroll-area";

import { useEditorStore } from "@/features/editor/store";

import { ConfirmDeleteDialog, MoveDialog, NameDialog } from "./dialogs";
import { findNode, useTreeStore } from "./store";

type DialogState =
  | { kind: "none" }
  | { kind: "new-note"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "rename"; path: string }
  | { kind: "move"; path: string }
  | { kind: "delete"; path: string };

export interface FileTreeProps {
  notebookId: string;
}

/** Recursive, keyboard-navigable file tree with a context menu per entry. */
export function FileTree({ notebookId }: FileTreeProps) {
  const nodes = useTreeStore((s) => s.nodes);
  const status = useTreeStore((s) => s.status);
  const error = useTreeStore((s) => s.error);
  const expanded = useTreeStore((s) => s.expanded);
  const selectedPath = useTreeStore((s) => s.selectedPath);
  const activePath = useEditorStore((s) => s.activePath);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const folders = useMemo(() => collectFolders(nodes), [nodes]);

  const openFile = useCallback(
    (path: string) => {
      useTreeStore.getState().select(path);
      void useEditorStore.getState().open(notebookId, path);
    },
    [notebookId],
  );

  const closeDialog = () => {
    setDialog({ kind: "none" });
  };

  if (status === "loading" && nodes.length === 0) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading files">
        {[80, 60, 70, 50].map((w, i) => (
          <div
            key={i}
            className="h-4 animate-pulse rounded-sm bg-surface-2"
            style={{ width: `${String(w)}%` }}
          />
        ))}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="p-3 text-sm text-danger" role="alert">
        Could not read the notebook: {error}
      </div>
    );
  }

  const tree = (
    <div role="tree" aria-label="Notes" className="py-1">
      {nodes.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-text">
          No notes yet. Right-click or use the + button to create one.
        </p>
      ) : (
        nodes.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            selectedPath={selectedPath}
            activePath={activePath}
            onOpenFile={openFile}
            onAction={setDialog}
          />
        ))
      )}
    </div>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ScrollArea className="min-h-0 flex-1 px-1">{tree}</ScrollArea>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setDialog({ kind: "new-note", dir: "" })}>
            <FileText /> New note
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setDialog({ kind: "new-folder", dir: "" })}>
            <FolderPlus /> New folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

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
          openFile(path);
        }}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
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
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
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
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
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
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
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
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      />
    </>
  );
}

function validateName(name: string): string | null {
  if (name.includes("/") || name.includes("\\"))
    return "Use the folder menu to create nested paths";
  if (name === "." || name === "..") return "That name is reserved";
  if (name.startsWith(".")) return "Hidden names (starting with a dot) are not shown in the tree";
  return null;
}

function collectFolders(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "dir") {
      out.push(node.path);
      collectFolders(node.children, out);
    }
  }
  return out;
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Record<string, true>;
  selectedPath: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onAction: (dialog: DialogState) => void;
}

function TreeRow({
  node,
  depth,
  expanded,
  selectedPath,
  activePath,
  onOpenFile,
  onAction,
}: TreeRowProps) {
  const isDir = node.kind === "dir";
  const isOpen = isDir && Boolean(expanded[node.path]);
  const selected = selectedPath === node.path;
  const active = activePath === node.path;
  const toggle = useTreeStore((s) => s.toggle);
  const select = useTreeStore((s) => s.select);

  const activate = () => {
    if (isDir) {
      select(node.path);
      toggle(node.path);
    } else {
      onOpenFile(node.path);
    }
  };

  const Icon = isDir
    ? isOpen
      ? FolderOpen
      : Folder
    : isMarkdown(node.path)
      ? FileText
      : /\.(png|jpe?g|gif|webp|svg)$/i.test(node.path)
        ? ImageIcon
        : File;
  const targetDir = isDir ? node.path : parentOf(node.path);

  return (
    <div role="none">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-expanded={isDir ? isOpen : undefined}
            aria-selected={selected}
            aria-level={depth + 1}
            tabIndex={selected ? 0 : -1}
            onClick={activate}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activate();
              } else if (e.key === "ArrowRight" && isDir && !isOpen) {
                toggle(node.path);
              } else if (e.key === "ArrowLeft" && isDir && isOpen) {
                toggle(node.path);
              } else if (e.key === "F2") {
                onAction({ kind: "rename", path: node.path });
              } else if (e.key === "Delete") {
                onAction({ kind: "delete", path: node.path });
              }
            }}
            onContextMenu={(e) => {
              // Keep the notebook-root menu (on the scroll area) from opening as well.
              e.stopPropagation();
              select(node.path);
            }}
            style={{ paddingLeft: `${String(8 + depth * 14)}px` }}
            className={cn(
              "group flex h-7 cursor-default items-center gap-1 rounded-sm pr-2 text-sm outline-none select-none",
              "focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset",
              active
                ? "bg-accent-soft text-text"
                : selected
                  ? "bg-surface-2 text-text"
                  : "text-text hover:bg-surface-2",
            )}
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-faint transition-transform duration-150",
                !isDir && "invisible",
                isOpen && "rotate-90",
              )}
              aria-hidden="true"
            />
            <Icon
              className={cn("size-4 shrink-0", isDir ? "text-muted-text" : "text-faint")}
              aria-hidden="true"
            />
            <span className="truncate">
              {isDir ? node.name : node.name.replace(/\.(md|markdown)$/i, "")}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onAction({ kind: "new-note", dir: targetDir })}>
            <FileText /> New note{isDir ? " inside" : ""}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onAction({ kind: "new-folder", dir: targetDir })}>
            <FolderPlus /> New folder{isDir ? " inside" : ""}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onAction({ kind: "rename", path: node.path })}>
            <Pencil /> Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onAction({ kind: "move", path: node.path })}>
            <Folder /> Move to…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => onAction({ kind: "delete", path: node.path })}
          >
            <Trash2 /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isDir && isOpen && (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedPath={selectedPath}
              activePath={activePath}
              onOpenFile={onOpenFile}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
