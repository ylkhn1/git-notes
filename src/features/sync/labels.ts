import type { RepoStatus, SyncState } from "@/lib/bindings";

export type SyncTone = "muted" | "ok" | "warn" | "danger" | "busy";

export interface SyncPresentation {
  label: string;
  tone: SyncTone;
  /** Longer explanation for tooltips and menus. */
  detail: string | null;
}

/** Turns the raw state + repo status into what the status bar shows. */
export function describeSync(state: SyncState, status: RepoStatus | null): SyncPresentation {
  if (status && !status.isRepo) {
    return { label: "Not a git repo", tone: "muted", detail: "Initialize git to enable sync." };
  }
  if (state.state === "syncing") return { label: "Syncing…", tone: "busy", detail: null };
  if (state.state === "error") return { label: "Sync error", tone: "danger", detail: state.data };
  if (state.state === "offline") {
    return {
      label: "Offline",
      tone: "warn",
      detail: "Changes are committed locally and will be pushed later.",
    };
  }
  if (state.state === "conflict") {
    const n = state.data.length;
    return {
      label: `${String(n)} conflict ${n === 1 ? "copy" : "copies"}`,
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
    return {
      label: "Changes to sync",
      tone: "muted",
      detail: pendingDetail(status),
    };
  }
  if (status && status.behind > 0) {
    return {
      label: "Updates available",
      tone: "muted",
      detail: `${String(status.behind)} new ${status.behind === 1 ? "commit" : "commits"} on the remote.`,
    };
  }
  return {
    label: state.state === "pending" ? "Sync scheduled" : "Not synced yet",
    tone: "muted",
    detail: null,
  };
}

function pendingDetail(status: RepoStatus | null): string | null {
  if (!status) return null;
  const parts: string[] = [];
  if (status.dirtyFiles > 0) {
    parts.push(
      `${String(status.dirtyFiles)} uncommitted ${status.dirtyFiles === 1 ? "file" : "files"}`,
    );
  }
  if (status.ahead > 0) {
    parts.push(`${String(status.ahead)} ${status.ahead === 1 ? "commit" : "commits"} to push`);
  }
  return parts.join(", ") || null;
}
