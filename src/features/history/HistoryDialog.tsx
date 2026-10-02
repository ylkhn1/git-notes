import { ArrowLeft, FileDiff as FileDiffIcon, GitCommitHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import { commands, type ChangedFile, type CommitInfo, type FileDiff } from "@/lib/bindings";
import { displayTitle } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { errorMessage, unwrap } from "@/lib/result";
import { formatDateTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";

import { DiffView } from "./DiffView";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
  /** Note to show history for; `null` means the whole notebook. */
  path: string | null;
}

/** Commit list with a per-file diff: two columns on desktop, two steps on mobile. */
export function HistoryDialog({ open, onOpenChange, notebookId, path }: Props) {
  useBackClose(open, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "h-full max-h-full w-full max-w-full rounded-none" : "h-[80vh] sm:max-w-4xl",
        )}
      >
        <DialogHeader className="border-b border-line px-5 py-3">
          <DialogTitle className="truncate">
            {path ? `History: ${displayTitle(path)}` : "Notebook history"}
          </DialogTitle>
          <DialogDescription className="truncate">
            {path ?? "Every commit in this notebook, newest first."}
          </DialogDescription>
        </DialogHeader>
        <HistoryBody notebookId={notebookId} path={path} />
      </DialogContent>
    </Dialog>
  );
}

type Loading<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

function HistoryBody({ notebookId, path }: { notebookId: string; path: string | null }) {
  const [commits, setCommits] = useState<Loading<CommitInfo[]>>({ status: "loading" });
  const [selected, setSelected] = useState<CommitInfo | null>(null);
  const [mobileStep, setMobileStep] = useState<"list" | "detail">("list");

  useEffect(() => {
    let cancelled = false;
    unwrap(commands.listHistory(notebookId, path, 200))
      .then((data) => {
        if (!cancelled) setCommits({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) setCommits({ status: "error", message: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, path]);

  const select = (commit: CommitInfo) => {
    setSelected(commit);
    setMobileStep("detail");
  };

  const list = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {commits.status === "loading" && (
        <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading history">
          <div className="h-12 animate-pulse rounded-md bg-surface-2" />
          <div className="h-12 animate-pulse rounded-md bg-surface-2" />
        </div>
      )}
      {commits.status === "error" && (
        <p role="alert" className="p-4 text-sm text-danger">
          {commits.message}
        </p>
      )}
      {commits.status === "ready" && commits.data.length === 0 && (
        <p className="p-6 text-center text-sm text-muted-text">
          {path
            ? "This note has not been committed yet."
            : "No commits yet — sync once to create the first one."}
        </p>
      )}
      {commits.status === "ready" && (
        <ul className="divide-y divide-line">
          {commits.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => select(c)}
                aria-current={selected?.id === c.id ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
                  isMobile && "min-h-11",
                  selected?.id === c.id && "bg-accent-soft",
                )}
              >
                <span className="line-clamp-2 text-sm">{c.summary || "(no message)"}</span>
                <span className="text-xs text-faint" title={formatDateTime(c.timeMs)}>
                  {formatRelativeTime(c.timeMs)} · {c.authorName} · {c.shortId}
                  {c.parentCount > 1 ? " · merge" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const detail = selected ? (
    <CommitDetail
      key={`${selected.id}:${path ?? ""}`}
      notebookId={notebookId}
      commit={selected}
      path={path}
    />
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-text">
      <GitCommitHorizontal className="size-8 text-faint" aria-hidden="true" />
      <p className="text-sm">Select a commit to see what changed.</p>
    </div>
  );

  if (isMobile) {
    return mobileStep === "list" || !selected ? (
      <div className="flex min-h-0 flex-1 flex-col">{list}</div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-1">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Back to commits"
            onClick={() => setMobileStep("list")}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <span className="truncate text-sm">{selected.summary}</span>
        </div>
        {detail}
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
      <div className="flex min-h-0 flex-col border-r border-line">{list}</div>
      <div className="flex min-h-0 flex-col">{detail}</div>
    </div>
  );
}

function CommitDetail({
  notebookId,
  commit,
  path,
}: {
  notebookId: string;
  commit: CommitInfo;
  path: string | null;
}) {
  // Mounted with a key per commit, so plain initial state is enough to reset.
  const [files, setFiles] = useState<Loading<ChangedFile[]>>(
    path ? { status: "ready", data: [] } : { status: "loading" },
  );
  const [filePath, setFilePath] = useState<string | null>(path);
  const [diff, setDiff] = useState<{ forPath: string; result: Loading<FileDiff> } | null>(null);

  useEffect(() => {
    if (path) return;
    let cancelled = false;
    unwrap(commands.listCommitFiles(notebookId, commit.id))
      .then((data) => {
        if (cancelled) return;
        setFiles({ status: "ready", data });
        setFilePath(data[0]?.path ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setFiles({ status: "error", message: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, commit.id, path]);

  useEffect(() => {
    if (!filePath) return;
    const target = filePath;
    let cancelled = false;
    unwrap(commands.getFileDiff(notebookId, commit.id, target))
      .then((data) => {
        if (!cancelled) setDiff({ forPath: target, result: { status: "ready", data } });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setDiff({ forPath: target, result: { status: "error", message: errorMessage(e) } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, commit.id, filePath]);

  const current: Loading<FileDiff> | null = filePath
    ? diff?.forPath === filePath
      ? diff.result
      : { status: "loading" }
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-2 text-xs text-muted-text">
        <div className="truncate text-sm text-text">{commit.summary}</div>
        <div className="truncate">
          {commit.authorName} &lt;{commit.authorEmail}&gt; · {formatDateTime(commit.timeMs)} ·{" "}
          {commit.shortId}
        </div>
      </div>
      {!path && files.status === "ready" && files.data.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
          {files.data.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setFilePath(f.path)}
              aria-pressed={f.path === filePath}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-surface-2",
                f.path === filePath && "bg-accent-soft text-text",
              )}
              title={f.path}
            >
              <FileDiffIcon className="size-3.5 text-faint" aria-hidden="true" />
              {displayTitle(f.path)}
              <span className="text-faint">{kindMark(f.kind)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {files.status === "loading" && (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading changed files">
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        )}
        {files.status === "error" && (
          <p role="alert" className="p-4 text-sm text-danger">
            {files.message}
          </p>
        )}
        {files.status === "ready" && !path && files.data.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-text">This commit changed no files.</p>
        )}
        {current?.status === "loading" && (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading diff">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        )}
        {current?.status === "error" && (
          <p role="alert" className="p-4 text-sm text-danger">
            {current.message}
          </p>
        )}
        {current?.status === "ready" && <DiffView diff={current.data} />}
      </div>
    </div>
  );
}

function kindMark(kind: ChangedFile["kind"]): string {
  switch (kind) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "modified":
      return "M";
    default:
      return "";
  }
}
