import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  History,
  KeyRound,
  Loader2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useState } from "react";

import { formatRelativeTime } from "@/lib/time";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

import { useConflictsDialog } from "@/features/conflicts/dialog-store";
import { selectActiveTab, useEditorStore } from "@/features/editor/store";
import { HistoryDialog } from "@/features/history/HistoryDialog";
import { useNotebooksStore } from "@/features/notebooks/store";
import { useSettingsStore } from "@/features/settings/store";

import { CredentialsDialog } from "./CredentialsDialog";
import { describeSync, type SyncTone } from "./labels";
import { RemoteDialog } from "./RemoteDialog";
import { useSyncStore } from "./store";

const toneClass: Record<SyncTone, string> = {
  muted: "text-muted-text",
  ok: "text-muted-text",
  warn: "text-warning",
  danger: "text-danger",
  busy: "text-muted-text",
};

type OpenDialog = "none" | "remote" | "credentials" | "history";

/** Sync state + actions. `statusbar` is the compact desktop form, `appbar` the mobile icon button. */
export function SyncIndicator({ variant }: { variant: "statusbar" | "appbar" }) {
  const notebook = useNotebooksStore((s) => s.current);
  const status = useSyncStore((s) => s.status);
  const state = useSyncStore((s) => s.state);
  const statusError = useSyncStore((s) => s.statusError);
  const plan = useSyncStore((s) => s.plan);
  const conflictCount = useSyncStore((s) => s.conflicts.length);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const syncNow = useSyncStore((s) => s.syncNow);
  const autoSync = useSettingsStore((s) => s.settings.autoSync);
  const autoSyncDelay = useSettingsStore((s) => s.settings.autoSyncDelaySecs);
  const showConflicts = useConflictsDialog((s) => s.show);
  const activePath = useEditorStore((s) => selectActiveTab(s)?.path ?? null);
  const [dialog, setDialog] = useState<OpenDialog>("none");
  const now = useNow(plan?.nextAttemptMs !== null && plan?.nextAttemptMs !== undefined);

  if (!notebook) return null;

  const view = describeSync({
    state,
    status,
    conflicts: conflictCount,
    plan,
    autoSync,
    now,
  });
  const canSync = Boolean(status?.isRepo && status.remoteUrl) && state.state !== "syncing";
  const icon = {
    tone: view.tone,
    isRepo: status?.isRepo ?? true,
    hasRemote: Boolean(status?.remoteUrl),
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "statusbar" ? (
            <button
              type="button"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-xs hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                toneClass[view.tone],
              )}
              aria-label={`Sync: ${view.label}`}
            >
              <SyncIcon {...icon} className="size-3.5" />
              {view.label}
            </button>
          ) : (
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={`Sync: ${view.label}`}
              className={cn("relative", toneClass[view.tone])}
            >
              <SyncIcon {...icon} className="size-5" />
              {(view.tone === "warn" || view.tone === "danger") && (
                <span
                  className={cn(
                    "absolute top-2 right-2 size-2 rounded-full",
                    view.tone === "danger" ? "bg-danger" : "bg-warning",
                  )}
                  aria-hidden="true"
                />
              )}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={variant === "statusbar" ? "start" : "end"} className="w-72">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className={cn("flex items-center gap-1.5", toneClass[view.tone])}>
              <SyncIcon {...icon} className="size-3.5" spin={false} /> {view.label}
            </span>
            {(view.detail ?? statusError) && (
              <span className="text-xs font-normal text-muted-text">
                {view.detail ?? statusError}
              </span>
            )}
          </DropdownMenuLabel>
          {status?.isRepo && (
            <div className="px-2 pb-1.5 text-xs text-faint">
              {status.branch && <div>Branch {status.branch}</div>}
              {status.remoteUrl && <div className="truncate">{status.remoteUrl}</div>}
              {status.lastCommit && (
                <div className="truncate">Last commit: {status.lastCommit.summary}</div>
              )}
              {status.remoteUrl && (
                <div>
                  {autoSync
                    ? `Auto-sync ${String(autoSyncDelay)} s after changes and on focus`
                    : "Auto-sync off"}
                  {lastSyncedAt !== null && ` · synced ${formatRelativeTime(lastSyncedAt, now)}`}
                </div>
              )}
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canSync}
            onSelect={() => {
              void syncNow();
            }}
          >
            <RefreshCw /> Sync now
            {variant === "statusbar" && <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>}
          </DropdownMenuItem>
          {conflictCount > 0 && (
            <DropdownMenuItem onSelect={() => showConflicts()}>
              <AlertTriangle className="text-warning" /> Review{" "}
              {conflictCount === 1 ? "conflict copy" : "conflict copies"}…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setDialog("remote")}>
            <Settings2 /> {status?.isRepo ? "Sync settings…" : "Set up git…"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("credentials")}>
            <KeyRound /> Credentials…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!status?.isRepo} onSelect={() => setDialog("history")}>
            <History /> {activePath ? "History of this note…" : "History…"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RemoteDialog
        open={dialog === "remote"}
        onOpenChange={(o) => setDialog(o ? "remote" : "none")}
      />
      <CredentialsDialog
        open={dialog === "credentials"}
        onOpenChange={(o) => setDialog(o ? "credentials" : "none")}
      />
      <HistoryDialog
        open={dialog === "history"}
        onOpenChange={(o) => setDialog(o ? "history" : "none")}
        notebookId={notebook.id}
        path={activePath}
      />
    </>
  );
}

function SyncIcon({
  tone,
  isRepo,
  hasRemote,
  className,
  spin = true,
}: {
  tone: SyncTone;
  isRepo: boolean;
  hasRemote: boolean;
  className: string;
  spin?: boolean;
}) {
  const props = {
    className: cn(className, spin && tone === "busy" && "animate-spin"),
    "aria-hidden": true as const,
  };
  if (!isRepo || !hasRemote) return <CloudOff {...props} />;
  switch (tone) {
    case "busy":
      return <Loader2 {...props} />;
    case "ok":
      return <Check {...props} />;
    case "warn":
    case "danger":
      return <AlertTriangle {...props} />;
    default:
      return <Cloud {...props} />;
  }
}
