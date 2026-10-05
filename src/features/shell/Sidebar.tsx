import {
  ChevronsUpDown,
  CloudDownload,
  FolderOpen,
  FolderPlus,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { createDebouncer } from "@/lib/debounce";
import { useT } from "@/lib/i18n";
import { parentOf } from "@/lib/paths";
import { formatShortcut } from "@/lib/shortcuts";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

import { useEditorStore } from "@/features/editor/store";
import { useNotebooksStore } from "@/features/notebooks/store";
import { useSettingsStore } from "@/features/settings/store";
import { FileTree } from "@/features/tree/FileTree";
import { findNode, useTreeStore } from "@/features/tree/store";

import { useUiStore } from "./ui-store";

const MIN_WIDTH = 160;
const MAX_WIDTH = 600;
const persist = createDebouncer(400);

/** Notebook switcher + file tree. Resizable by dragging its right edge. */
export function Sidebar() {
  const t = useT();
  const notebooks = useNotebooksStore((s) => s.notebooks);
  const current = useNotebooksStore((s) => s.current);
  const openDialog = useUiStore((s) => s.openDialog);
  const openPalette = useUiStore((s) => s.openPalette);
  const width = useSettingsStore((s) => s.settings.sidebarWidth);
  const update = useSettingsStore((s) => s.update);
  const widthRef = useRef(width);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthRef.current;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const onMove = (e: PointerEvent) => {
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + e.clientX - startX));
        document.documentElement.style.setProperty("--gn-sidebar-width", `${String(next)}px`);
        widthRef.current = next;
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        persist.schedule("sidebar", () => {
          void update({ sidebarWidth: widthRef.current });
        });
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [update],
  );

  useEffect(() => {
    widthRef.current = width;
    document.documentElement.style.setProperty("--gn-sidebar-width", `${String(width)}px`);
  }, [width]);

  const newNote = () => {
    const tree = useTreeStore.getState();
    const selected = tree.selectedPath;
    const node = selected ? findNode(tree.nodes, selected) : undefined;
    const dir = node ? (node.kind === "dir" ? node.path : parentOf(node.path)) : "";
    void tree.createNote(dir).then((path) => {
      if (current) void useEditorStore.getState().open(current.id, path);
    });
  };

  if (!current) return null;

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-surface"
      style={{ width: "var(--gn-sidebar-width, 260px)" }}
      aria-label={t("shell.sidebar")}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 pr-1 pl-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start gap-1.5 px-2 font-medium"
            >
              <span className="truncate">{current.name}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>{t("shell.notebooks")}</DropdownMenuLabel>
            {notebooks.map((nb) => (
              <DropdownMenuItem
                key={nb.id}
                onSelect={() => {
                  void useNotebooksStore.getState().select(nb.id);
                }}
                className={nb.id === current.id ? "font-medium" : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{nb.name}</span>
                <span className="ml-auto max-w-[55%] truncate pl-3 text-2xs text-faint">
                  {nb.path}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openDialog("newNotebook")}>
              <FolderPlus /> {t("shell.newNotebook")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openDialog("clone")}>
              <CloudDownload /> {t("shell.cloneRepository")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void useNotebooksStore.getState().openFolder();
              }}
            >
              <FolderOpen /> {t("shell.openFolder")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openDialog("settings")}>
              <Settings /> {t("shell.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void useNotebooksStore.getState().closeCurrent();
              }}
            >
              <X /> {t("shell.closeNotebook")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("commands.goToNote")}
              onClick={() => openPalette("files")}
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("shell.goToNote", { shortcut: formatShortcut("Mod+P") })}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("shell.newNote")}
              onClick={newNote}
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("shell.newNoteShortcut", { shortcut: formatShortcut("Mod+N") })}
          </TooltipContent>
        </Tooltip>
      </div>
      <FileTree notebookId={current.id} />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("shell.resizeSidebar")}
        onPointerDown={startResize}
        className="absolute inset-y-0 -right-0.5 w-1.5 cursor-col-resize transition-colors hover:bg-accent/40 active:bg-accent/60"
      />
    </aside>
  );
}
