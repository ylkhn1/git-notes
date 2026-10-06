import { ChevronRight, Hash } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { isMobile } from "@/lib/platform";
import { buildTagTree, type TagNode } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/ui/scroll-area";

import { useLinkIndex } from "@/features/links/use-backlinks";

import { searchFor } from "./store";

/** Every tag of the notebook as a tree with note counts; a click lists the tag's notes. */
export function TagsPanel({ notebookId }: { notebookId: string }) {
  const t = useT();
  const index = useLinkIndex(notebookId);
  const tree = useMemo(() => (index ? buildTagTree(index) : null), [index]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  if (!tree) {
    return (
      <div className="space-y-2 p-3" aria-busy="true">
        <div className="h-4 w-1/2 animate-pulse rounded-sm bg-surface-2" />
        <div className="h-4 w-2/3 animate-pulse rounded-sm bg-surface-2" />
      </div>
    );
  }
  if (tree.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-text">{t("search.noTags")}</p>;
  }

  const toggle = (tag: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (!next.delete(tag)) next.add(tag);
      return next;
    });

  const rows = (nodes: TagNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const open = expanded.has(node.tag);
      return (
        <li key={node.tag} role="treeitem" aria-expanded={node.children.length ? open : undefined}>
          <div
            className={cn(
              "flex items-center rounded-md hover:bg-surface-2",
              isMobile ? "min-h-11" : "h-7",
            )}
            style={{ paddingLeft: `${String(depth * 12 + 4)}px` }}
          >
            {node.children.length > 0 ? (
              <button
                type="button"
                aria-label={t(open ? "search.collapseTag" : "search.expandTag", { tag: node.tag })}
                onClick={() => toggle(node.tag)}
                className="flex size-5 shrink-0 items-center justify-center rounded text-faint hover:text-text"
              >
                <ChevronRight
                  className={cn("size-3.5 transition-transform", open && "rotate-90")}
                  aria-hidden="true"
                />
              </button>
            ) : (
              <span className="size-5 shrink-0" />
            )}
            <button
              type="button"
              onClick={() => searchFor(`tag:${node.tag}`)}
              className="flex h-full min-w-0 flex-1 items-center gap-1 pr-2 text-left text-sm"
              title={`#${node.tag}`}
            >
              <Hash className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span
                className="text-xs text-faint tabular-nums"
                aria-label={t("search.tagNotes", { count: node.count })}
              >
                {node.count}
              </span>
            </button>
          </div>
          {open && node.children.length > 0 && (
            <ul role="group">{rows(node.children, depth + 1)}</ul>
          )}
        </li>
      );
    });

  return (
    <ScrollArea className="min-h-0 flex-1 px-1">
      <ul role="tree" aria-label={t("search.tags")} className="py-1">
        {rows(tree, 0)}
      </ul>
    </ScrollArea>
  );
}
