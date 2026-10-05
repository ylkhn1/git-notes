import type { RepoStatus, SyncPlan, SyncState } from "@/lib/bindings";

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
    return { label: "Not a git repo", tone: "muted", detail: "Initialize git to enable sync." };
  }
  if (state.state === "syncing") return { label: "Syncing…", tone: "busy", detail: null };
  if (state.state === "error") return { label: "Sync error", tone: "danger", detail: state.data };
  if (state.state === "offline") {
    const queued = status ? status.ahead : 0;
    const parts: string[] = [];
    if (queued > 0) parts.push(`${String(queued)} ${plural(queued, "commit")} waiting to push`);
    const retry = plan?.trigger === "retry" && plan.nextAttemptMs !== null ? plan : null;
    parts.push(
      retry
        ? `Retrying in ${formatCountdown(retry.nextAttemptMs ?? now, now)}.`
        : autoSync
          ? "Retries when you edit or return to the app."
          : "Use Sync now when you are back online.",
    );
    return { label: "Offline", tone: "warn", detail: parts.join(" · ") };
  }
  if (state.state === "pending" && status?.remoteUrl) {
    // Transient and informative; the banner keeps showing conflicts meanwhile.
    const due = plan?.trigger === "edit" ? plan.nextAttemptMs : null;
    return {
      label: due === null ? "Sync pending" : `Syncing in ${formatCountdown(due, now)}`,
      tone: "muted",
      detail: "Automatic sync runs shortly after your last change.",
    };
  }
  if (conflicts > 0) {
    return {
      label: `${String(conflicts)} conflict ${plural(conflicts, "copy", "copies")}`,
      tone: "warn",
      detail: "Both versions were kept. Review them to choose which one to keep.",
    };
  }
  if (state.state === "conflict") {
    const n = state.data.length;
    return {
      label: `${String(n)} conflict ${plural(n, "copy", "copies")}`,
      tone: "warn",
      detail: "Both versions were kept; the local one is in a “(conflict …)” file.",
    };
  }
  if (status && !status.remoteUrl) {
    return { label: "Local only", tone: "muted", detail: "Add a remote to sync this notebook." };
  }
  const pending = status ? status.dirtyFiles + status.ahead : 0;
  if (state.state === "upToDate" && pending === 0) {
    return { label: "Up to date", tone: "ok", detail: null };
  }
  if (pending > 0) {
    const detail = pendingDetail(status);
    return {
      label: "Changes to sync",
      tone: "muted",
      detail: autoSync
        ? detail
        : [detail, "Auto-sync is off; use Sync now."].filter(Boolean).join(" · "),
    };
  }
  if (status && status.behind > 0) {
    return {
      label: "Updates available",
      tone: "muted",
      detail: `${String(status.behind)} new ${plural(status.behind, "commit")} on the remote.`,
    };
  }
  return { label: "Not synced yet", tone: "muted", detail: null };
}

function pendingDetail(status: RepoStatus | null): string | null {
  if (!status) return null;
  const parts: string[] = [];
  if (status.dirtyFiles > 0) {
    parts.push(`${String(status.dirtyFiles)} uncommitted ${plural(status.dirtyFiles, "file")}`);
  }
  if (status.ahead > 0) {
    parts.push(`${String(status.ahead)} ${plural(status.ahead, "commit")} to push`);
  }
  return parts.join(", ") || null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "12 s", "3 min", "2 h" until `targetMs`; never negative. */
export function formatCountdown(targetMs: number, now: number): string {
  const seconds = Math.max(0, Math.round((targetMs - now) / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.round(minutes / 60))} h`;
}
