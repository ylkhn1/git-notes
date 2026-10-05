import type { RepoStatus, SyncPlan, SyncState } from "@/lib/bindings";
import { t } from "@/lib/i18n";
import { formatDuration } from "@/lib/time";

export type SyncTone = "muted" | "ok" | "warn" | "danger" | "busy";

export interface SyncPresentation {
  label: string;
  tone: SyncTone;
  /** Longer explanation for tooltips and menus. */
  detail: string | null;
}

export interface SyncFacts {
  state: SyncState;
  status: RepoStatus | null;
  /** Conflict copies currently in the notebook (from any device). */
  conflicts: number;
  plan: SyncPlan | null;
  autoSync: boolean;
  /** Clock for countdowns; injected so tests are deterministic. */
  now: number;
}

/** Turns the raw state, repo status and scheduler plan into what the status bar shows. */
export function describeSync(facts: SyncFacts): SyncPresentation {
  const { state, status, conflicts, plan, autoSync, now } = facts;
  if (status && !status.isRepo) {
    return { label: t("sync.notARepo"), tone: "muted", detail: t("sync.notARepoHint") };
  }
  if (state.state === "syncing") return { label: t("sync.syncing"), tone: "busy", detail: null };
  if (state.state === "error") {
    return { label: t("sync.syncError"), tone: "danger", detail: state.data };
  }
  if (state.state === "offline") {
    const queued = status ? status.ahead : 0;
    const parts: string[] = [];
    if (queued > 0) parts.push(t("sync.commitsWaitingToPush", { count: queued }));
    const retry = plan?.trigger === "retry" && plan.nextAttemptMs !== null ? plan : null;
    parts.push(
      retry
        ? t("sync.retryingIn", { duration: formatCountdown(retry.nextAttemptMs ?? now, now) })
        : autoSync
          ? t("sync.retriesOnEditOrFocus")
          : t("sync.useSyncNowWhenOnline"),
    );
    return { label: t("sync.offline"), tone: "warn", detail: parts.join(" · ") };
  }
  if (state.state === "pending" && status?.remoteUrl) {
    // Transient and informative; the banner keeps showing conflicts meanwhile.
    const due = plan?.trigger === "edit" ? plan.nextAttemptMs : null;
    return {
      label:
        due === null
          ? t("sync.syncPending")
          : t("sync.syncingIn", { duration: formatCountdown(due, now) }),
      tone: "muted",
      detail: t("sync.syncPendingHint"),
    };
  }
  if (conflicts > 0) {
    return {
      label: t("sync.conflictCopies", { count: conflicts }),
      tone: "warn",
      detail: t("sync.conflictCopiesHint"),
    };
  }
  if (state.state === "conflict") {
    return {
      label: t("sync.conflictCopies", { count: state.data.length }),
      tone: "warn",
      detail: t("sync.conflictFileHint"),
    };
  }
  if (status && !status.remoteUrl) {
    return { label: t("sync.localOnly"), tone: "muted", detail: t("sync.localOnlyHint") };
  }
  const pending = status ? status.dirtyFiles + status.ahead : 0;
  if (state.state === "upToDate" && pending === 0) {
    return { label: t("sync.upToDate"), tone: "ok", detail: null };
  }
  if (pending > 0) {
    const detail = pendingDetail(status);
    return {
      label: t("sync.changesToSync"),
      tone: "muted",
      detail: autoSync ? detail : [detail, t("sync.autoSyncOffHint")].filter(Boolean).join(" · "),
    };
  }
  if (status && status.behind > 0) {
    return {
      label: t("sync.updatesAvailable"),
      tone: "muted",
      detail: t("sync.newCommitsOnRemote", { count: status.behind }),
    };
  }
  return { label: t("sync.notSyncedYet"), tone: "muted", detail: null };
}

function pendingDetail(status: RepoStatus | null): string | null {
  if (!status) return null;
  const parts: string[] = [];
  if (status.dirtyFiles > 0) parts.push(t("sync.uncommittedFiles", { count: status.dirtyFiles }));
  if (status.ahead > 0) parts.push(t("sync.commitsToPush", { count: status.ahead }));
  return parts.join(", ") || null;
}

/** "12 s", "3 min", "2 h" until `targetMs`; never negative. */
export function formatCountdown(targetMs: number, now: number): string {
  return formatDuration(targetMs - now);
}
