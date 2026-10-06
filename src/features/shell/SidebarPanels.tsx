import { FolderTree, Hash, type LucideIcon, Network, Search } from "lucide-react";

import { type MessageKey, useT } from "@/lib/i18n";
import { isMobile } from "@/lib/platform";
import { cn } from "@/lib/utils";

import { SearchPanel } from "@/features/search/SearchPanel";
import { focusSearch } from "@/features/search/store";
import { TagsPanel } from "@/features/search/TagsPanel";
import { FileTree } from "@/features/tree/FileTree";

import { type SidebarView, useUiStore } from "./ui-store";

const TABS: { view: SidebarView; label: MessageKey; icon: LucideIcon }[] = [
  { view: "files", label: "search.files", icon: FolderTree },
  { view: "search", label: "search.search", icon: Search },
  { view: "tags", label: "search.tags", icon: Hash },
];

/** Files / Search / Tags switcher, plus the graph button. */
export function SidebarTabs() {
  const t = useT();
  const view = useUiStore((s) => s.sidebarView);
  return (
    <div
      role="tablist"
      aria-label={t("search.panels")}
      className="flex shrink-0 items-center gap-0.5 px-2 pb-1.5"
    >
      {TABS.map(({ view: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => (v === "search" ? focusSearch() : useUiStore.getState().showSidebar(v))}
          className={cn(
            "flex flex-1 items-center justify-center gap-1 rounded-md text-xs text-muted-text hover:bg-surface-2 hover:text-text",
            isMobile ? "h-10" : "h-7",
            view === v && "bg-surface-2 text-text",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {t(label)}
        </button>
      ))}
      <button
        type="button"
        aria-label={t("graph.open")}
        title={t("graph.open")}
        onClick={() => useUiStore.getState().openDialog("graph")}
        className={cn(
          "flex items-center justify-center rounded-md text-muted-text hover:bg-surface-2 hover:text-text",
          isMobile ? "size-10" : "size-7",
        )}
      >
        <Network className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** The panel selected by {@link SidebarTabs}. */
export function SidebarBody({
  notebookId,
  onOpenFile,
}: {
  notebookId: string;
  /** Mobile: a note was opened, close the drawer. */
  onOpenFile?: () => void;
}) {
  const view = useUiStore((s) => s.sidebarView);
  if (view === "search") return <SearchPanel notebookId={notebookId} onOpenFile={onOpenFile} />;
  if (view === "tags") return <TagsPanel notebookId={notebookId} />;
  return <FileTree notebookId={notebookId} mobile={isMobile} onOpenFile={onOpenFile} />;
}
