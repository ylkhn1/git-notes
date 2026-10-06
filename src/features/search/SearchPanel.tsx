import { ChevronRight, FileText, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { MatchRange, NoteMatch } from "@/lib/bindings";
import { useT } from "@/lib/i18n";
import { displayTitle, parentOf } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/ui/scroll-area";

import { goToLine } from "@/features/editor/goto";
import { useEditorStore } from "@/features/editor/store";
import { useUiStore } from "@/features/shell/ui-store";

import { SEARCH_LIMIT, useSearchStore } from "./store";

/** Hits shown per note before "N more". */
const COLLAPSED_HITS = 3;

/** Full-text search in the sidebar (desktop) or the notes drawer (mobile). */
export function SearchPanel({
  notebookId,
  onOpenFile,
}: {
  notebookId: string;
  /** Called after a result was opened (the mobile drawer closes). */
  onOpenFile?: () => void;
}) {
  const t = useT();
  const query = useSearchStore((s) => s.query);
  const results = useSearchStore((s) => s.results);
  const forQuery = useSearchStore((s) => s.forQuery);
  const error = useSearchStore((s) => s.error);
  const focusToken = useSearchStore((s) => s.focusToken);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    useSearchStore.getState().setNotebook(notebookId);
  }, [notebookId]);
  useEffect(() => {
    // On touch devices only focus on request, so opening the drawer does not pop the keyboard.
    if (isMobile && focusToken === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const trimmed = query.trim();
  const pending = trimmed !== "" && forQuery !== trimmed;

  const open = (path: string, line?: number) => {
    if (line !== undefined) goToLine(path, line);
    void useEditorStore.getState().open(notebookId, path);
    onOpenFile?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-2">
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-bg px-2 focus-within:border-accent">
          <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => useSearchStore.getState().setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (query) useSearchStore.getState().setQuery("");
              else useUiStore.getState().showSidebar("files");
            }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className={cn(
              "min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden",
              isMobile && "py-2.5 text-base",
            )}
          />
          {query && (
            <button
              type="button"
              aria-label={t("search.clear")}
              onClick={() => {
                useSearchStore.getState().setQuery("");
                inputRef.current?.focus();
              }}
              className="rounded p-0.5 text-faint hover:text-text"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-1">
        {trimmed === "" && <SyntaxHelp />}
        {pending && !results && (
          <p className="px-3 py-2 text-xs text-faint" aria-live="polite">
            {t("search.searching")}
          </p>
        )}
        {error && forQuery === trimmed && (
          <p role="alert" className="px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {trimmed !== "" && results && (
          <div className={cn("pb-4", pending && "opacity-60")}>
            <p className="px-3 pb-1 text-xs text-faint" aria-live="polite">
              {results.notes.length === 0
                ? t("search.noResults")
                : t("search.notesFound", { count: results.notes.length })}
              {results.truncated && ` · ${t("search.moreNotes", { limit: SEARCH_LIMIT })}`}
            </p>
            <ul>
              {results.notes.map((note) => (
                <NoteResult key={note.path} note={note} terms={results.terms} onOpen={open} />
              ))}
            </ul>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function SyntaxHelp() {
  const t = useT();
  const rows: [string, string, string][] = [
    ['"…"', '"', t("search.syntaxPhrase")],
    ["tag:", "tag:", t("search.syntaxTag")],
    ["path:", "path:", t("search.syntaxPath")],
  ];
  return (
    <div className="space-y-1.5 px-3 py-2 text-xs text-muted-text">
      <p>{t("search.syntaxHint")}</p>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-1">
        {rows.map(([label, insert, help]) => (
          <div key={label} className="contents">
            <dt>
              <button
                type="button"
                className="rounded bg-surface-2 px-1 font-mono text-text hover:bg-accent-soft"
                onClick={() => {
                  useSearchStore.getState().setQuery(insert);
                  useSearchStore.setState((s) => ({ focusToken: s.focusToken + 1 }));
                }}
              >
                {label}
              </button>
            </dt>
            <dd>{help}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function NoteResult({
  note,
  terms,
  onOpen,
}: {
  note: NoteMatch;
  terms: readonly string[];
  onOpen: (path: string, line?: number) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const title = displayTitle(note.path);
  const dir = parentOf(note.path);
  const hits = expanded ? note.hits : note.hits.slice(0, COLLAPSED_HITS);
  const collapsed = note.hits.length - hits.length;
  return (
    <li className="mb-1">
      <button
        type="button"
        onClick={() => onOpen(note.path)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-surface-2",
          isMobile && "min-h-11",
        )}
        title={note.path}
      >
        <FileText className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        <span className="min-w-0 truncate font-medium">
          <Marked text={title} ranges={note.titleMatch ? termRanges(title, terms) : []} />
        </span>
        {dir && <span className="min-w-0 shrink truncate text-xs text-faint">{dir}</span>}
      </button>
      {hits.length > 0 && (
        <ul className="ml-4 border-l border-line">
          {hits.map((hit) => (
            <li key={hit.lineNo}>
              <button
                type="button"
                onClick={() => onOpen(note.path, hit.lineNo)}
                className={cn(
                  "block w-full rounded-r-md py-0.5 pr-2 pl-2.5 text-left text-xs leading-5 text-muted-text hover:bg-surface-2 hover:text-text",
                  isMobile && "py-2",
                )}
              >
                <span className="line-clamp-2 break-words">
                  <Marked text={hit.line} ranges={hit.ranges} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {collapsed > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="ml-4 flex items-center gap-1 px-2.5 py-0.5 text-xs text-faint hover:text-text"
        >
          <ChevronRight className="size-3" aria-hidden="true" />
          {t("search.moreHits", { count: collapsed + note.moreHits })}
        </button>
      ) : (
        note.moreHits > 0 && (
          <p className="ml-4 px-2.5 py-0.5 text-xs text-faint">
            {t("search.moreHits", { count: note.moreHits })}
          </p>
        )
      )}
    </li>
  );
}

/** Char ranges of `terms` in `text`, case-insensitive. */
function termRanges(text: string, terms: readonly string[]): MatchRange[] {
  const lower = text.toLowerCase();
  const out: MatchRange[] = [];
  for (const term of terms) {
    if (!term) continue;
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
      const start = Array.from(lower.slice(0, at)).length;
      out.push({ start, end: start + Array.from(term).length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** `text` with the char `ranges` wrapped in `<mark>`. */
function Marked({ text, ranges }: { text: string; ranges: readonly MatchRange[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const chars = Array.from(text);
  const parts: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((range, i) => {
    if (range.start < pos) return;
    if (range.start > pos) parts.push(chars.slice(pos, range.start).join(""));
    parts.push(
      <mark key={i} className="rounded-sm bg-warning/30 text-text">
        {chars.slice(range.start, range.end).join("")}
      </mark>,
    );
    pos = range.end;
  });
  if (pos < chars.length) parts.push(chars.slice(pos).join(""));
  return <>{parts}</>;
}
