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

import { useT } from "@/lib/i18n";
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
import { useNotebooksStore } from "@/features/notebooks/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUiStore } from "@/features/shell/ui-store";

import { describeSync, type SyncTone } from "./labels";
import { useSyncStore } from "./store";

const toneClass: Record<SyncTone, string> = {
  muted: "text-muted-text",
  ok: "text-muted-text",
  warn: "text-warning",
  danger: "text-danger",
  busy: "text-muted-text",
};

/** Sync state + actions. `statusbar` is the compact desktop form, `appbar` the mobile icon button. */
export function SyncIndicator({ variant }: { variant: "statusbar" | "appbar" }) {
  const t = useT();
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
  const periodicMins = useSettingsStore((s) => s.settings.periodicSyncMins);
  const showConflicts = useConflictsDialog((s) => s.show);
  const openDialog = useUiStore((s) => s.openDialog);
  const activePath = useEditorStore((s) => selectActiveTab(s)?.path ?? null);
  // Only edit and retry plans show a live countdown; the periodic timer is minutes away.
  const now = useNow(plan?.trigger === "edit" || plan?.trigger === "retry");

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "statusbar" ? (
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-xs hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              toneClass[view.tone],
            )}
            aria-label={t("sync.ariaLabel", { status: view.label })}
          >
            <SyncIcon {...icon} className="size-3.5" />
            {view.label}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t("sync.ariaLabel", { status: view.label })}
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
            {status.branch && <div>{t("sync.branch", { branch: status.branch })}</div>}
            {status.remoteUrl && <div className="truncate">{status.remoteUrl}</div>}
            {status.lastCommit && (
              <div className="truncate">
                {t("sync.lastCommit", { summary: status.lastCommit.summary })}
              </div>
            )}
            {status.remoteUrl && (
              <div>
                {autoSync
                  ? periodicMins > 0
                    ? t("sync.autoSyncSchedule", { delay: autoSyncDelay, minutes: periodicMins })
                    : t("sync.autoSyncScheduleNoPeriodic", { delay: autoSyncDelay })
                  : t("sync.autoSyncOff")}
                {lastSyncedAt !== null &&
                  ` · ${t("sync.syncedWhen", { when: formatRelativeTime(lastSyncedAt, now) })}`}
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
          <RefreshCw /> {t("sync.syncNow")}
          {variant === "statusbar" && <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>}
        </DropdownMenuItem>
        {conflictCount > 0 && (
          <DropdownMenuItem onSelect={() => showConflicts()}>
            <AlertTriangle className="text-warning" />{" "}
            {t("sync.reviewConflictCopies", { count: conflictCount })}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => openDialog("remote")}>
          <Settings2 /> {status?.isRepo ? t("sync.remoteAndGitSetup") : t("sync.setUpGit")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDialog("credentials")}>
          <KeyRound /> {t("sync.credentials")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!status?.isRepo} onSelect={() => openDialog("history")}>
          <History /> {activePath ? t("sync.historyOfThisNote") : t("sync.history")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDialog("settings", { section: "sync" })}>
          <Settings2 /> {t("sync.syncSettings")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
