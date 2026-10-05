import { X } from "lucide-react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { isDirty, type Tab, useEditorStore } from "@/features/editor/store";

/** Open documents. Middle-click or the × closes; unsaved tabs show a dot instead of ×. */
export function TabBar() {
  const t = useT();
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const activate = useEditorStore((s) => s.activate);
  const close = useEditorStore((s) => s.close);

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={t("shell.openNotes")}
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface"
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.path}
          tab={tab}
          active={tab.path === activePath}
          onActivate={() => {
            activate(tab.path);
          }}
          onClose={() => {
            void close(tab.path);
          }}
        />
      ))}
    </div>
  );
}

function TabItem({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const dirty = isDirty(tab);
  return (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      title={tab.path}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
        if (e.key === "Delete" || e.key === "Backspace") onClose();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
      className={cn(
        "group relative flex max-w-56 min-w-0 cursor-default items-center gap-1 border-r border-line pr-1 pl-3 text-sm transition-colors",
        active ? "bg-bg text-text" : "text-muted-text hover:bg-surface-2 hover:text-text",
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden="true" />}
      <span className="truncate">{tab.title}</span>
      <button
        type="button"
        aria-label={
          dirty
            ? t("shell.closeTabUnsaved", { title: tab.title })
            : t("shell.closeTab", { title: tab.title })
        }
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-text transition-colors hover:bg-surface-2 hover:text-text",
          !active && !dirty && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        {dirty ? (
          <span className="size-2 rounded-full bg-accent group-hover:hidden" aria-hidden="true" />
        ) : null}
        <X className={cn("size-3.5", dirty && "hidden group-hover:block")} aria-hidden="true" />
      </button>
    </div>
  );
}
