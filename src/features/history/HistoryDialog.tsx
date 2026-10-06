import {
  ArrowLeft,
  FileDiff as FileDiffIcon,
  GitCommitHorizontal,
  GitCompareArrows,
  RotateCcw,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import {
  type ChangedFile,
  type CommitInfo,
  commands,
  type DeletedFile,
  type FileDiff,
  type FileVersion,
  type NoteCommit,
} from "@/lib/bindings";
import { t as translate, useT } from "@/lib/i18n";
import { baseName, displayTitle } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { errorMessage, unwrap } from "@/lib/result";
import { formatDateTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";

import { useChangesStore } from "@/features/editor/changes-store";
import { useUiStore } from "@/features/shell/ui-store";

import { DiffView } from "./DiffView";
import { overwritesClosedFile, type RestoreRequest, restoreVersion } from "./restore";
import { VersionPreview } from "./VersionPreview";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
  /** The active note; shown when the dialog was opened for the note rather than the notebook. */
  path: string | null;
}

/**
 * Note history (commits that changed the note, following renames) or notebook history
 * (every commit, plus deleted files). Any version can be viewed whole, compared inline in
 * the editor or restored. Two columns on desktop, two steps on mobile.
 */
export function HistoryDialog({ open, onOpenChange, notebookId, path }: Props) {
  const t = useT();
  const scope = useUiStore((s) => s.historyScope);
  const notePath = scope === "note" ? path : null;
  useBackClose(open, () => onOpenChange(false));
  const done = () => onOpenChange(false);
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
            {notePath
              ? t("history.noteTitle", { title: displayTitle(notePath) })
              : t("history.notebookTitle")}
          </DialogTitle>
          <DialogDescription className="truncate">
            {notePath ?? t("history.notebookDescription")}
          </DialogDescription>
        </DialogHeader>
        {notePath ? (
          <NoteHistory key={notePath} notebookId={notebookId} path={notePath} onDone={done} />
        ) : (
          <NotebookHistory notebookId={notebookId} onDone={done} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Loading<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

/** Loads `load()` whenever `deps` change; stale results are dropped. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loading<T> {
  const [state, setState] = useState<{ key: string; value: Loading<T> } | null>(null);
  const key = JSON.stringify(deps);
  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ key, value: { status: "ready", data } });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ key, value: { status: "error", message: errorMessage(e) } });
      });
    return () => {
      cancelled = true;
    };
    // `key` stands for `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state.value : { status: "loading" };
}

// --- Layout ---------------------------------------------------------------------------------

function TwoPane({
  list,
  detail,
  showDetail,
  detailTitle,
  onBack,
}: {
  list: ReactNode;
  detail: ReactNode;
  showDetail: boolean;
  detailTitle: string;
  onBack: () => void;
}) {
  const t = useT();
  if (isMobile) {
    return !showDetail ? (
      <div className="flex min-h-0 flex-1 flex-col">{list}</div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-1">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t("history.backToCommits")}
            onClick={onBack}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <span className="truncate text-sm">{detailTitle}</span>
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

function ListState<T>({
  state,
  label,
  empty,
  children,
}: {
  state: Loading<T[]>;
  label: string;
  empty: string;
  children: (data: T[]) => ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {state.status === "loading" && (
        <div className="space-y-2 p-3" aria-busy="true" aria-label={label}>
          <div className="h-12 animate-pulse rounded-md bg-surface-2" />
          <div className="h-12 animate-pulse rounded-md bg-surface-2" />
        </div>
      )}
      {state.status === "error" && (
        <p role="alert" className="p-4 text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.status === "ready" && state.data.length === 0 && (
        <p className="p-6 text-center text-sm text-muted-text">{empty}</p>
      )}
      {state.status === "ready" && state.data.length > 0 && (
        <ul className="divide-y divide-line">{children(state.data)}</ul>
      )}
    </div>
  );
}

function ListButton({
  selected,
  onClick,
  title,
  meta,
}: {
  selected: boolean;
  onClick: () => void;
  title: ReactNode;
  meta: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
        isMobile && "min-h-11",
        selected && "bg-accent-soft",
      )}
    >
      <span className="line-clamp-2 text-sm">{title}</span>
      <span className="text-xs text-faint">{meta}</span>
    </button>
  );
}

function commitMeta(c: CommitInfo): ReactNode {
  return (
    <span title={formatDateTime(c.timeMs)}>
      {formatRelativeTime(c.timeMs)} · {c.authorName} · {c.shortId}
      {c.parentCount > 1 ? ` · ${translate("history.merge")}` : ""}
    </span>
  );
}

function SelectHint() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-text">
      <GitCommitHorizontal className="size-8 text-faint" aria-hidden="true" />
      <p className="text-sm">{t("history.selectCommitHint")}</p>
    </div>
  );
}

function CommitHeader({ commit }: { commit: CommitInfo }) {
  return (
    <div className="shrink-0 border-b border-line px-4 py-2 text-xs text-muted-text">
      <div className="truncate text-sm text-text">{commit.summary}</div>
      <div className="truncate">
        {commit.authorName} &lt;{commit.authorEmail}&gt; · {formatDateTime(commit.timeMs)} ·{" "}
        {commit.shortId}
      </div>
    </div>
  );
}

type ViewMode = "changes" | "version";

/** Changes / Version switch plus the actions for one file in one commit. */
function FileToolbar({
  mode,
  onMode,
  actions,
}: {
  mode: ViewMode | null;
  onMode: (mode: ViewMode) => void;
  actions: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
      {mode && (
        <div
          role="group"
          aria-label={t("history.viewMode")}
          className="flex rounded-md bg-surface-2 p-0.5"
        >
          {(["changes", "version"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onMode(m)}
              className={cn(
                "rounded px-2 py-0.5 text-xs text-muted-text",
                mode === m && "bg-bg text-text shadow-sm",
              )}
            >
              {m === "changes" ? t("history.tabChanges") : t("history.tabVersion")}
            </button>
          ))}
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-1">{actions}</div>
    </div>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label={label}>
      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
    </div>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="p-4 text-sm text-danger">
      {children}
    </p>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="p-6 text-center text-sm text-muted-text">{children}</p>;
}

function DiffLoader({
  notebookId,
  commitId,
  path,
  oldPath,
}: {
  notebookId: string;
  commitId: string;
  path: string;
  oldPath: string | null;
}) {
  const t = useT();
  const diff = useLoad<FileDiff>(
    () => unwrap(commands.getFileDiff(notebookId, commitId, path, oldPath)),
    [notebookId, commitId, path, oldPath],
  );
  if (diff.status === "loading") return <Skeleton label={t("history.loadingDiff")} />;
  if (diff.status === "error") return <ErrorText>{diff.message}</ErrorText>;
  return <DiffView diff={diff.data} />;
}

function VersionLoader({
  notebookId,
  commitId,
  path,
  before,
}: {
  notebookId: string;
  commitId: string;
  path: string;
  before: boolean;
}) {
  const t = useT();
  const version = useLoad<FileVersion>(
    () => unwrap(commands.getFileVersion(notebookId, path, commitId, before)),
    [notebookId, commitId, path, before],
  );
  if (version.status === "loading") return <Skeleton label={t("history.loadingVersion")} />;
  if (version.status === "error") return <ErrorText>{version.message}</ErrorText>;
  if (version.data.missing) return <Empty>{t("history.versionMissing")}</Empty>;
  if (version.data.text === null) return <Empty>{t("history.binaryVersion")}</Empty>;
  return <VersionPreview notebookId={notebookId} path={path} text={version.data.text} />;
}

/** Restore button with confirmation when a closed file would be overwritten. */
function RestoreButton({
  request,
  timeMs,
  label,
  onDone,
}: {
  request: RestoreRequest;
  timeMs: number;
  label: string;
  onDone: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setError(null);
    restoreVersion(request)
      .then(() => {
        setConfirming(false);
        onDone();
      })
      .catch((e: unknown) => {
        setError(errorMessage(e));
      })
      .finally(() => setBusy(false));
  };
  const target = request.target ?? request.path;
  return (
    <>
      {error && !confirming && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
      <Button
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={() => {
          if (overwritesClosedFile(request)) setConfirming(true);
          else run();
        }}
      >
        <RotateCcw data-icon="inline-start" /> {label}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("history.confirmRestoreTitle", { name: baseName(target) })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("history.confirmRestoreDescription", { date: formatDateTime(timeMs) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                run();
              }}
            >
              {t("history.replace")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// --- Note history ---------------------------------------------------------------------------

function NoteHistory({
  notebookId,
  path,
  onDone,
}: {
  notebookId: string;
  path: string;
  onDone: () => void;
}) {
  const t = useT();
  const entries = useLoad<NoteCommit[]>(
    () => unwrap(commands.listNoteHistory(notebookId, path, 200)),
    [notebookId, path],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const data = entries.status === "ready" ? entries.data : [];
  const entry = selected === null ? null : (data[selected] ?? null);

  const list = (
    <ListState
      state={entries}
      label={t("history.loadingHistory")}
      empty={t("history.noteNotCommitted")}
    >
      {(items) =>
        items.map((e, i) => (
          <li key={e.commit.id}>
            <ListButton
              selected={selected === i}
              onClick={() => {
                setSelected(i);
                setShowDetail(true);
              }}
              title={e.commit.summary || t("history.noMessage")}
              meta={
                <>
                  {commitMeta(e.commit)}
                  {e.kind === "deleted" && ` · ${t("history.deletedInCommit")}`}
                  {e.kind === "renamed" && ` · ${t("history.renamedInCommit")}`}
                  {e.path !== path && ` · ${t("history.asPath", { path: baseName(e.path) })}`}
                </>
              }
            />
          </li>
        ))
      }
    </ListState>
  );

  const detail =
    entry && selected !== null ? (
      <NoteCommitDetail
        key={entry.commit.id}
        notebookId={notebookId}
        notePath={path}
        entry={entry}
        olderPath={data[selected + 1]?.path ?? null}
        onDone={onDone}
      />
    ) : (
      <SelectHint />
    );

  return (
    <TwoPane
      list={list}
      detail={detail}
      showDetail={showDetail && entry !== null}
      detailTitle={entry?.commit.summary ?? ""}
      onBack={() => setShowDetail(false)}
    />
  );
}

function NoteCommitDetail({
  notebookId,
  notePath,
  entry,
  olderPath,
  onDone,
}: {
  notebookId: string;
  notePath: string;
  entry: NoteCommit;
  /** The note's path in the previous history entry (the name before a rename). */
  olderPath: string | null;
  onDone: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<ViewMode>("changes");
  const deleted = entry.kind === "deleted";
  const request: RestoreRequest = {
    notebookId,
    commitId: entry.commit.id,
    path: entry.path,
    before: deleted,
    target: notePath,
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CommitHeader commit={entry.commit} />
      <FileToolbar
        mode={mode}
        onMode={setMode}
        actions={
          <>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                useChangesStore.getState().show({
                  path: notePath,
                  commitId: entry.commit.id,
                  versionPath: entry.path,
                  before: deleted,
                  timeMs: entry.commit.timeMs,
                });
                onDone();
              }}
            >
              <GitCompareArrows data-icon="inline-start" /> {t("history.compareInNote")}
            </Button>
            <RestoreButton
              request={request}
              timeMs={entry.commit.timeMs}
              label={t("history.restoreVersion")}
              onDone={onDone}
            />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "changes" ? (
          <DiffLoader
            notebookId={notebookId}
            commitId={entry.commit.id}
            path={entry.path}
            oldPath={entry.kind === "renamed" ? olderPath : null}
          />
        ) : (
          <VersionLoader
            notebookId={notebookId}
            commitId={entry.commit.id}
            path={entry.path}
            before={deleted}
          />
        )}
      </div>
    </div>
  );
}

// --- Notebook history -----------------------------------------------------------------------

function NotebookHistory({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<"commits" | "deleted">("commits");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-3 pt-1.5">
        {(["commits", "deleted"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              "-mb-px border-b-2 border-transparent px-2 pb-1.5 text-sm text-muted-text hover:text-text",
              tab === name && "border-accent text-text",
            )}
          >
            {name === "commits" ? t("history.commitsTab") : t("history.deletedTab")}
          </button>
        ))}
      </div>
      {tab === "commits" ? (
        <NotebookCommits notebookId={notebookId} onDone={onDone} />
      ) : (
        <DeletedFiles notebookId={notebookId} onDone={onDone} />
      )}
    </div>
  );
}

function NotebookCommits({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const t = useT();
  const commits = useLoad<CommitInfo[]>(
    () => unwrap(commands.listHistory(notebookId, null, 200)),
    [notebookId],
  );
  const [selected, setSelected] = useState<CommitInfo | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const list = (
    <ListState state={commits} label={t("history.loadingHistory")} empty={t("history.noCommits")}>
      {(items) =>
        items.map((c) => (
          <li key={c.id}>
            <ListButton
              selected={selected?.id === c.id}
              onClick={() => {
                setSelected(c);
                setShowDetail(true);
              }}
              title={c.summary || t("history.noMessage")}
              meta={commitMeta(c)}
            />
          </li>
        ))
      }
    </ListState>
  );
  return (
    <TwoPane
      list={list}
      detail={
        selected ? (
          <CommitDetail
            key={selected.id}
            notebookId={notebookId}
            commit={selected}
            onDone={onDone}
          />
        ) : (
          <SelectHint />
        )
      }
      showDetail={showDetail && selected !== null}
      detailTitle={selected?.summary ?? ""}
      onBack={() => setShowDetail(false)}
    />
  );
}

function CommitDetail({
  notebookId,
  commit,
  onDone,
}: {
  notebookId: string;
  commit: CommitInfo;
  onDone: () => void;
}) {
  const t = useT();
  const files = useLoad<ChangedFile[]>(
    () => unwrap(commands.listCommitFiles(notebookId, commit.id)),
    [notebookId, commit.id],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("changes");
  const list = files.status === "ready" ? files.data : [];
  const file = list.find((f) => f.path === picked) ?? list[0] ?? null;
  const deleted = file?.kind === "deleted";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CommitHeader commit={commit} />
      {list.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
          {list.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setPicked(f.path)}
              aria-pressed={f.path === file?.path}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-surface-2",
                f.path === file?.path && "bg-accent-soft text-text",
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
      {file && (
        <FileToolbar
          mode={mode}
          onMode={setMode}
          actions={
            <RestoreButton
              key={file.path}
              request={{ notebookId, commitId: commit.id, path: file.path, before: deleted }}
              timeMs={commit.timeMs}
              label={deleted ? t("history.restoreFile") : t("history.restoreVersion")}
              onDone={onDone}
            />
          }
        />
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {files.status === "loading" && <Skeleton label={t("history.loadingChangedFiles")} />}
        {files.status === "error" && <ErrorText>{files.message}</ErrorText>}
        {files.status === "ready" && list.length === 0 && (
          <Empty>{t("history.noFilesChanged")}</Empty>
        )}
        {file &&
          (mode === "changes" ? (
            <DiffLoader
              notebookId={notebookId}
              commitId={commit.id}
              path={file.path}
              oldPath={file.oldPath}
            />
          ) : (
            <VersionLoader
              notebookId={notebookId}
              commitId={commit.id}
              path={file.path}
              before={deleted}
            />
          ))}
      </div>
    </div>
  );
}

function DeletedFiles({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const t = useT();
  const deleted = useLoad<DeletedFile[]>(
    () => unwrap(commands.listDeletedFiles(notebookId, 200)),
    [notebookId],
  );
  const [selected, setSelected] = useState<DeletedFile | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const list = (
    <ListState state={deleted} label={t("history.loadingDeleted")} empty={t("history.noDeleted")}>
      {(items) =>
        items.map((d) => (
          <li key={d.path}>
            <ListButton
              selected={selected?.path === d.path}
              onClick={() => {
                setSelected(d);
                setShowDetail(true);
              }}
              title={<span title={d.path}>{d.path}</span>}
              meta={
                <span title={formatDateTime(d.commit.timeMs)}>
                  {t("history.deletedAgo", { time: formatRelativeTime(d.commit.timeMs) })} ·{" "}
                  {d.commit.authorName}
                </span>
              }
            />
          </li>
        ))
      }
    </ListState>
  );
  return (
    <TwoPane
      list={list}
      detail={
        selected ? (
          <div key={selected.path} className="flex min-h-0 flex-1 flex-col">
            <CommitHeader commit={selected.commit} />
            <FileToolbar
              mode={null}
              onMode={() => undefined}
              actions={
                <RestoreButton
                  request={{
                    notebookId,
                    commitId: selected.commit.id,
                    path: selected.path,
                    before: true,
                  }}
                  timeMs={selected.commit.timeMs}
                  label={t("history.restoreFile")}
                  onDone={onDone}
                />
              }
            />
            <div className="min-h-0 flex-1 overflow-auto">
              <VersionLoader
                notebookId={notebookId}
                commitId={selected.commit.id}
                path={selected.path}
                before
              />
            </div>
          </div>
        ) : (
          <SelectHint />
        )
      }
      showDetail={showDetail && selected !== null}
      detailTitle={selected?.path ?? ""}
      onBack={() => setShowDetail(false)}
    />
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
