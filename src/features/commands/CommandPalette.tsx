import { CornerDownLeft, FileText, Search, Terminal } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import { commands, type SearchHit, type TreeNode } from "@/lib/bindings";
import { createDebouncer } from "@/lib/debounce";
import { highlightRuns, rankItems } from "@/lib/fuzzy";
import { type MessageKey, t, useLocale, useT } from "@/lib/i18n";
import { displayTitle, parentOf } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { errorMessage, unwrap } from "@/lib/result";
import { formatShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";

import { goToLine } from "@/features/editor/goto";
import { selectRecent, useRecentStore } from "@/features/editor/recent";
import { useEditorStore } from "@/features/editor/store";
import { useNotebooksStore } from "@/features/notebooks/store";
import { type PaletteMode, useUiStore } from "@/features/shell/ui-store";
import { useTreeStore } from "@/features/tree/store";

import { availableCommands, type Command, type CommandGroup, commandGroupLabel } from "./registry";

const modes: { mode: PaletteMode; label: MessageKey; shortcut: string; icon: typeof Search }[] = [
  { mode: "commands", label: "palette.modeCommands", shortcut: "Mod+K", icon: Terminal },
  { mode: "files", label: "palette.modeNotes", shortcut: "Mod+P", icon: FileText },
  { mode: "search", label: "palette.modeSearch", shortcut: "Mod+Shift+F", icon: Search },
];

/** Command palette, quick switcher and full-text search in one overlay. */
export function CommandPalette() {
  const mode = useUiStore((s) => s.palette);
  const close = useUiStore((s) => s.closePalette);
  useT();
  useBackClose(mode !== null, close);
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          isMobile
            ? "top-0 h-full max-h-full w-full max-w-full translate-y-0 rounded-none"
            : "top-[12vh] max-h-[72vh] translate-y-0 sm:max-w-xl",
        )}
      >
        <DialogTitle className="sr-only">{t("palette.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("palette.description")}</DialogDescription>
        {mode !== null && <PaletteBody key={mode} mode={mode} />}
      </DialogContent>
    </Dialog>
  );
}

type Row =
  | { kind: "heading"; id: string; label: string }
  | { kind: "command"; id: string; command: Command; positions: number[] }
  | { kind: "file"; id: string; path: string; positions: number[]; recent: boolean }
  | { kind: "hit"; id: string; hit: SearchHit }
  | { kind: "note"; id: string; text: string };

function flattenFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "file") out.push(node.path);
    else flattenFiles(node.children, out);
  }
  return out;
}

const searchDebounce = createDebouncer(150);

function PaletteBody({ mode }: { mode: PaletteMode }) {
  const setMode = useUiStore((s) => s.openPalette);
  const close = useUiStore((s) => s.closePalette);
  const notebook = useNotebooksStore((s) => s.current);
  const nodes = useTreeStore((s) => s.nodes);
  const recent = useRecentStore(selectRecent(notebook?.id ?? null));
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<{
    forQuery: string;
    hits: SearchHit[];
    files: number;
    truncated: boolean;
    error: string | null;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Full-text search runs in Rust; debounce keystrokes.
  useEffect(() => {
    if (mode !== "search" || !notebook) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      searchDebounce.cancel("search");
      return;
    }
    searchDebounce.schedule("search", () => {
      unwrap(commands.searchNotes(notebook.id, trimmed, 100))
        .then((results) => {
          setSearch({
            forQuery: trimmed,
            hits: results.hits,
            files: results.filesMatched,
            truncated: results.truncated,
            error: null,
          });
        })
        .catch((e: unknown) => {
          setSearch({
            forQuery: trimmed,
            hits: [],
            files: 0,
            truncated: false,
            error: errorMessage(e),
          });
        });
    });
    return () => searchDebounce.cancel("search");
  }, [mode, notebook, query]);

  const rows = useMemo<Row[]>(() => {
    if (mode === "commands") {
      const ranked = rankItems(
        // The palette itself is already open; listing it would be noise.
        availableCommands().filter((c) => c.id !== "go.palette"),
        query,
        (c) => `${c.title} ${c.keywords ?? ""}`,
        60,
      );
      if (ranked.length === 0)
        return [{ kind: "note", id: "empty", text: t("palette.noMatchingCommands") }];
      const out: Row[] = [];
      let lastGroup: CommandGroup | null = null;
      for (const { item, match } of ranked) {
        if (query.trim() === "" && item.group !== lastGroup) {
          out.push({
            kind: "heading",
            id: `g:${item.group}`,
            label: commandGroupLabel(item.group),
          });
          lastGroup = item.group;
        }
        out.push({
          kind: "command",
          id: item.id,
          command: item,
          positions: match.positions.filter((p) => p < item.title.length),
        });
      }
      return out;
    }
    if (mode === "files") {
      const all = flattenFiles(nodes);
      if (all.length === 0) {
        return [{ kind: "note", id: "empty", text: t("palette.noNotesYet") }];
      }
      const recentSet = new Set(recent.filter((p) => all.includes(p)));
      if (query.trim() === "") {
        const rest = all.filter((p) => !recentSet.has(p));
        const out: Row[] = [];
        if (recentSet.size > 0) {
          out.push({ kind: "heading", id: "g:recent", label: t("palette.recentHeading") });
          for (const p of recent.filter((r) => recentSet.has(r))) {
            out.push({ kind: "file", id: `f:${p}`, path: p, positions: [], recent: true });
          }
          if (rest.length > 0) {
            out.push({ kind: "heading", id: "g:all", label: t("palette.allNotes") });
          }
        }
        for (const p of rest)
          out.push({ kind: "file", id: `f:${p}`, path: p, positions: [], recent: false });
        return out;
      }
      const ranked = rankItems(all, query, (p) => p, 60);
      if (ranked.length === 0)
        return [{ kind: "note", id: "empty", text: t("palette.noNotesMatch") }];
      // Recent notes win ties.
      ranked.sort((a, b) => {
        const d = b.match.score - a.match.score;
        if (Math.abs(d) > 0.5) return d;
        return Number(recentSet.has(b.item)) - Number(recentSet.has(a.item));
      });
      return ranked.map(({ item, match }) => ({
        kind: "file" as const,
        id: `f:${item}`,
        path: item,
        positions: match.positions,
        recent: recentSet.has(item),
      }));
    }
    // search
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return [{ kind: "note", id: "hint", text: t("palette.typeTwoChars") }];
    }
    if (search?.forQuery !== trimmed) {
      return [{ kind: "note", id: "loading", text: t("palette.searching") }];
    }
    if (search.error) return [{ kind: "note", id: "error", text: search.error }];
    if (search.hits.length === 0)
      return [{ kind: "note", id: "empty", text: t("palette.noMatches") }];
    const out: Row[] = [];
    let lastPath: string | null = null;
    for (const hit of search.hits) {
      if (hit.path !== lastPath) {
        out.push({ kind: "heading", id: `g:${hit.path}`, label: hit.path });
        lastPath = hit.path;
      }
      out.push({ kind: "hit", id: `h:${hit.path}:${String(hit.lineNo)}`, hit });
    }
    const counts = t("palette.matchesInNotes", {
      count: search.hits.length,
      notes: t("palette.notesCount", { count: search.files }),
    });
    const summary = search.truncated
      ? `${counts} · ${t("palette.showingFirst", { limit: 100 })}`
      : counts;
    out.push({ kind: "note", id: "summary", text: summary });
    return out;
    // `locale` is listed because the rows contain translated text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nodes, query, recent, search, locale]);

  const selectable = useMemo(
    () =>
      rows.map((r, i) => ({ r, i })).filter(({ r }) => r.kind !== "heading" && r.kind !== "note"),
    [rows],
  );
  const activeIndex = selectable[Math.min(active, Math.max(selectable.length - 1, 0))]?.i ?? -1;

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${String(activeIndex)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const run = (row: Row) => {
    const id = notebook?.id;
    if (row.kind === "command") {
      close();
      void row.command.run();
    } else if (row.kind === "file" && id) {
      close();
      void useEditorStore.getState().open(id, row.path);
    } else if (row.kind === "hit" && id) {
      close();
      goToLine(row.hit.path, row.hit.lineNo);
      void useEditorStore.getState().open(id, row.hit.path);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(selectable.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) run(row);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const i = modes.findIndex((m) => m.mode === mode);
      const next = modes[(i + (e.shiftKey ? modes.length - 1 : 1)) % modes.length];
      if (next) setMode(next.mode);
    }
  };

  const placeholder =
    mode === "commands"
      ? t("palette.placeholderCommands")
      : mode === "files"
        ? t("palette.placeholderNotes")
        : t("palette.placeholderSearch");

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${String(activeIndex)}` : undefined}
          aria-label={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            "min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-faint",
            isMobile ? "h-12" : "h-11 text-sm",
          )}
        />
      </div>
      <div
        role="tablist"
        aria-label={t("palette.paletteMode")}
        className="flex shrink-0 gap-1 border-b border-line px-2 py-1.5"
      >
        {modes
          .filter((m) => m.mode === "commands" || notebook)
          .map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={m.mode === mode}
              onClick={() => setMode(m.mode)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 text-xs hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                isMobile ? "h-9" : "h-7",
                m.mode === mode ? "bg-accent-soft text-text" : "text-muted-text",
              )}
            >
              <m.icon className="size-3.5" aria-hidden="true" />
              {t(m.label)}
              {!isMobile && (
                <span className="text-2xs text-faint">{formatShortcut(m.shortcut)}</span>
              )}
            </button>
          ))}
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={t("palette.results")}
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {rows.map((row, index) => {
          if (row.kind === "heading") {
            return (
              <div
                key={row.id}
                role="presentation"
                className="truncate px-3 pt-2 pb-1 text-2xs font-medium tracking-wide text-faint uppercase"
              >
                {row.label}
              </div>
            );
          }
          if (row.kind === "note") {
            return (
              <p key={row.id} className="px-3 py-4 text-center text-sm text-muted-text">
                {row.text}
              </p>
            );
          }
          const selected = index === activeIndex;
          return (
            <div
              key={row.id}
              id={`${listId}-${String(index)}`}
              role="option"
              aria-selected={selected}
              data-index={index}
              onMouseMove={() => {
                const pos = selectable.findIndex(({ i }) => i === index);
                if (pos !== -1 && pos !== active) setActive(pos);
              }}
              onClick={() => run(row)}
              className={cn(
                "mx-1 flex cursor-default items-center gap-2 rounded-md px-2 text-sm",
                isMobile ? "min-h-11 py-2" : "min-h-8 py-1",
                selected && "bg-accent-soft",
              )}
            >
              <RowContent row={row} />
              {selected && !isMobile && (
                <CornerDownLeft className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function RowContent({ row }: { row: Row }) {
  if (row.kind === "command") {
    const Icon = row.command.icon;
    return (
      <>
        {Icon ? (
          <Icon className="size-4 shrink-0 text-muted-text" aria-hidden="true" />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">
          <Highlighted text={row.command.title} positions={row.positions} />
        </span>
        {row.command.shortcut && !isMobile && (
          <kbd className="ml-2 shrink-0 rounded border border-line bg-surface-2 px-1.5 font-sans text-2xs text-muted-text">
            {formatShortcut(row.command.shortcut)}
          </kbd>
        )}
      </>
    );
  }
  if (row.kind === "file") {
    const title = displayTitle(row.path);
    const dir = parentOf(row.path);
    const titleStart = row.path.lastIndexOf(title);
    const titlePositions = row.positions
      .filter((p) => p >= titleStart && p < titleStart + title.length)
      .map((p) => p - titleStart);
    const dirPositions = row.positions.filter((p) => p < dir.length);
    return (
      <>
        <FileText className="size-4 shrink-0 text-muted-text" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          <Highlighted text={title} positions={titlePositions} />
          {dir && (
            <span className="ml-2 text-xs text-faint">
              <Highlighted text={dir} positions={dirPositions} />
            </span>
          )}
        </span>
        {row.recent && (
          <span className="shrink-0 text-2xs text-faint">{t("palette.recentBadge")}</span>
        )}
      </>
    );
  }
  if (row.kind !== "hit") return null;
  const chars = Array.from(row.hit.line);
  const before = chars.slice(0, row.hit.matchStart).join("");
  const match = chars.slice(row.hit.matchStart, row.hit.matchEnd).join("");
  const after = chars.slice(row.hit.matchEnd).join("");
  return (
    <>
      <span className="w-8 shrink-0 text-right text-xs text-faint tabular-nums">
        {row.hit.lineNo}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {before}
        <mark className="rounded-sm bg-warning/30 text-text">{match}</mark>
        {after}
      </span>
    </>
  );
}

function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>;
  return (
    <>
      {highlightRuns(text, positions).map((run, i) =>
        run.hit ? (
          <mark key={i} className="bg-transparent font-semibold text-accent">
            {run.text}
          </mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}
