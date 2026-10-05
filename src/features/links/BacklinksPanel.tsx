import { ChevronRight, FileText } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useT } from "@/lib/i18n";
import { displayTitle, parentOf } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { Backlink } from "@/lib/wikilinks";

import { goToLine } from "@/features/editor/goto";
import { useEditorStore } from "@/features/editor/store";

import { useLinksStore } from "./store";
import { useBacklinks } from "./use-backlinks";

/**
 * Collapsible "links to this note" strip under the editor. On touch devices it is only
 * shown when there is something to show.
 */
export function BacklinksPanel({
  notebookId,
  path,
  compact = false,
}: {
  notebookId: string;
  path: string;
  compact?: boolean;
}) {
  const t = useT();
  const open = useLinksStore((s) => s.panelOpen);
  const toggle = useLinksStore((s) => s.togglePanel);
  const loadedFor = useLinksStore((s) => s.notebookId);
  const backlinks = useBacklinks(path);

  useEffect(() => {
    if (loadedFor !== notebookId) {
      useLinksStore
        .getState()
        .load(notebookId)
        .catch(() => undefined);
    }
  }, [loadedFor, notebookId]);

  const groups = useMemo(() => {
    const map = new Map<string, Backlink[]>();
    for (const link of backlinks ?? []) {
      const list = map.get(link.path) ?? [];
      list.push(link);
      map.set(link.path, list);
    }
    return Array.from(map);
  }, [backlinks]);

  const count = backlinks?.length ?? 0;
  if (compact && count === 0) return null;

  const openLink = (link: Backlink) => {
    goToLine(link.path, link.lineNo);
    void useEditorStore.getState().open(notebookId, link.path);
  };

  return (
    <section
      aria-label={t("links.backlinks")}
      className="shrink-0 border-t border-line bg-surface text-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggle()}
        disabled={count === 0}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 text-left text-xs text-muted-text hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:hover:text-muted-text",
          compact ? "h-10" : "h-8",
        )}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && count > 0 && "rotate-90",
            count === 0 && "invisible",
          )}
          aria-hidden="true"
        />
        {backlinks === null
          ? t("links.loading")
          : count === 0
            ? t("links.none")
            : t("links.count", { count, notes: t("links.notesCount", { count: groups.length }) })}
      </button>
      {open && count > 0 && (
        <ul className="max-h-56 overflow-y-auto px-2 pb-2">
          {groups.map(([source, links]) => (
            <li key={source} className="py-1">
              <button
                type="button"
                onClick={() => {
                  const first = links[0];
                  if (first) openLink(first);
                }}
                className="flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-2"
              >
                <FileText className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
                <span className="truncate font-medium">{displayTitle(source)}</span>
                {parentOf(source) && (
                  <span className="truncate text-xs text-faint">{parentOf(source)}</span>
                )}
              </button>
              <ul>
                {links.map((link) => (
                  <li key={`${source}:${String(link.lineNo)}`}>
                    <button
                      type="button"
                      onClick={() => openLink(link)}
                      className="flex w-full min-w-0 gap-2 rounded-sm py-0.5 pr-1 pl-6 text-left text-xs text-muted-text hover:bg-surface-2 hover:text-text"
                    >
                      <span className="w-6 shrink-0 text-right text-faint tabular-nums">
                        {link.lineNo}
                      </span>
                      <span className="truncate">{link.line}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
