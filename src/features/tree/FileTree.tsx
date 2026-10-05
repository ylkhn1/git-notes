import {
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useCallback } from "react";

import type { TreeNode } from "@/lib/bindings";
import { useT } from "@/lib/i18n";
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

import { type TreeDialog, useTreeDialogStore } from "./dialog-store";
import { useTreeStore } from "./store";
import { TreeDialogs } from "./TreeDialogs";

export interface FileTreeProps {
  notebookId: string;
  /** Touch layout: 44px rows, an actions button per row, bottom sheet instead of context menu. */
  mobile?: boolean;
  /** Extra callback when a file is opened (the mobile drawer closes itself). */
  onOpenFile?: (path: string) => void;
}

/** Recursive, keyboard-navigable file tree with per-entry actions. */
export function FileTree({ notebookId, mobile = false, onOpenFile }: FileTreeProps) {
  const t = useT();
  const nodes = useTreeStore((s) => s.nodes);
  const status = useTreeStore((s) => s.status);
  const error = useTreeStore((s) => s.error);
  const expanded = useTreeStore((s) => s.expanded);
  const selectedPath = useTreeStore((s) => s.selectedPath);
  const activePath = useEditorStore((s) => s.activePath);
  const openDialog = useTreeDialogStore((s) => s.open);

  const openFile = useCallback(
    (path: string) => {
      useTreeStore.getState().select(path);
      void useEditorStore.getState().open(notebookId, path);
      onOpenFile?.(path);
    },
    [notebookId, onOpenFile],
  );

  if (status === "loading" && nodes.length === 0) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-label={t("tree.loadingFiles")}>
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
        {t("tree.couldNotRead", { error: error ?? "" })}
      </div>
    );
  }

  const tree = (
    <div role="tree" aria-label={t("tree.notes")} className="py-1">
      {nodes.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-text">
          {mobile ? t("tree.emptyMobile") : t("tree.emptyDesktop")}
        </p>
      ) : (
        nodes.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            mobile={mobile}
            expanded={expanded}
            selectedPath={selectedPath}
            activePath={activePath}
            onOpenFile={openFile}
            onAction={openDialog}
          />
        ))
      )}
    </div>
  );

  return (
    <>
      {mobile ? (
        <ScrollArea className="min-h-0 flex-1 px-1">{tree}</ScrollArea>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <ScrollArea className="min-h-0 flex-1 px-1">{tree}</ScrollArea>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => openDialog({ kind: "new-note", dir: "" })}>
              <FileText /> {t("tree.newNote")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => openDialog({ kind: "new-folder", dir: "" })}>
              <FolderPlus /> {t("tree.newFolder")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      <TreeDialogs notebookId={notebookId} onNoteCreated={openFile} />
    </>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  mobile: boolean;
  expanded: Record<string, true>;
  selectedPath: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onAction: (dialog: TreeDialog) => void;
}

function TreeRow({
  node,
  depth,
  mobile,
  expanded,
  selectedPath,
  activePath,
  onOpenFile,
  onAction,
}: TreeRowProps) {
  const t = useT();
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

  const row = (
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
      style={{ paddingLeft: `${String(8 + depth * (mobile ? 16 : 14))}px` }}
      className={cn(
        "group flex cursor-default items-center gap-1 rounded-sm pr-1 outline-none select-none",
        mobile ? "h-11 text-base" : "h-7 text-sm",
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
      <span className="min-w-0 flex-1 truncate">
        {isDir ? node.name : node.name.replace(/\.(md|markdown)$/i, "")}
      </span>
      {mobile && (
        <button
          type="button"
          aria-label={t("tree.actionsFor", { name: node.name })}
          onClick={(e) => {
            e.stopPropagation();
            select(node.path);
            onAction({ kind: "actions", path: node.path });
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-text active:bg-surface-2"
        >
          <MoreHorizontal className="size-5" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <div role="none">
      {mobile ? (
        row
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => onAction({ kind: "new-note", dir: targetDir })}>
              <FileText /> {isDir ? t("tree.newNoteInside") : t("tree.newNote")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onAction({ kind: "new-folder", dir: targetDir })}>
              <FolderPlus /> {isDir ? t("tree.newFolderInside") : t("tree.newFolder")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onAction({ kind: "rename", path: node.path })}>
              <Pencil /> {t("common.rename")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onAction({ kind: "move", path: node.path })}>
              <Folder /> {t("tree.moveTo")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => onAction({ kind: "delete", path: node.path })}
            >
              <Trash2 /> {t("common.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      {isDir && isOpen && (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              mobile={mobile}
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
