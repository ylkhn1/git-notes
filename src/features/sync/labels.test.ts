import { describe, expect, it } from "vitest";

import type { RepoStatus, SyncPlan, SyncState } from "@/lib/bindings";
import { setLocale } from "@/lib/i18n";

import { describeSync, formatCountdown, type SyncFacts } from "./labels";

const status = (patch: Partial<RepoStatus> = {}): RepoStatus => ({
  isRepo: true,
  branch: "main",
  detached: false,
  remoteUrl: "git@github.com:me/notes.git",
  dirtyFiles: 0,
  ahead: 0,
  behind: 0,
  lastCommit: null,
  inProgress: null,
  ...patch,
});

const NOW = 1_000_000;

function facts(state: SyncState, repo: RepoStatus | null, patch: Partial<SyncFacts> = {}) {
  return describeSync({
    state,
    status: repo,
    conflicts: 0,
    plan: null,
    autoSync: true,
    now: NOW,
    ...patch,
  });
}

const plan = (patch: Partial<SyncPlan>): SyncPlan => ({
  nextAttemptMs: null,
  trigger: null,
  retryAttempt: 0,
  ...patch,
});

describe("describeSync", () => {
  it("prefers repository facts over the sync state", () => {
    expect(facts({ state: "upToDate" }, status({ isRepo: false })).label).toBe("Not a git repo");
    expect(facts({ state: "upToDate" }, status({ remoteUrl: null })).label).toBe("Local only");
  });

  it("maps states to labels and tones", () => {
    expect(facts({ state: "syncing" }, status())).toMatchObject({
      label: "Syncing…",
      tone: "busy",
    });
    expect(facts({ state: "error", data: "boom" }, status())).toMatchObject({
      label: "Sync error",
      tone: "danger",
      detail: "boom",
    });
    expect(facts({ state: "conflict", data: ["a", "b"] }, status()).label).toBe(
      "2 conflict copies",
    );
    expect(facts({ state: "upToDate" }, status())).toMatchObject({
      label: "Up to date",
      tone: "ok",
    });
  });

  it("describes the offline queue and its retry", () => {
    const offline = facts({ state: "offline" }, status({ ahead: 2 }), {
      plan: plan({ nextAttemptMs: NOW + 125_000, trigger: "retry", retryAttempt: 1 }),
    });
    expect(offline).toMatchObject({ label: "Offline", tone: "warn" });
    expect(offline.detail).toBe("2 commits waiting to push · Retrying in 2 min.");

    expect(facts({ state: "offline" }, status(), { autoSync: false }).detail).toBe(
      "Use Sync now when you are back online.",
    );
  });

  it("counts conflict copies found in the tree over the last sync result", () => {
    expect(facts({ state: "upToDate" }, status(), { conflicts: 1 })).toMatchObject({
      label: "1 conflict copy",
      tone: "warn",
    });
    // Offline still wins: it explains why the resolution is not on the remote yet.
    expect(facts({ state: "offline" }, status(), { conflicts: 1 }).label).toBe("Offline");
  });

  it("shows a countdown while a debounced sync is pending", () => {
    expect(
      facts({ state: "pending" }, status(), {
        plan: plan({ nextAttemptMs: NOW + 12_400, trigger: "edit" }),
      }).label,
    ).toBe("Syncing in 12 s");
    expect(facts({ state: "pending" }, status()).label).toBe("Sync pending");
    // The countdown is transient; the banner still lists the conflicts meanwhile.
    expect(facts({ state: "pending" }, status(), { conflicts: 2 }).label).toBe("Sync pending");
    expect(facts({ state: "pending" }, status({ remoteUrl: null })).label).toBe("Local only");
  });

  it("reports pending work", () => {
    expect(facts({ state: "upToDate" }, status({ dirtyFiles: 2, ahead: 1 }))).toMatchObject({
      label: "Changes to sync",
      detail: "2 uncommitted files, 1 commit to push",
    });
    expect(
      facts({ state: "upToDate" }, status({ dirtyFiles: 1 }), { autoSync: false }).detail,
    ).toBe("1 uncommitted file · Auto-sync is off; use Sync now.");
    expect(facts({ state: "idle" }, status({ behind: 3 })).label).toBe("Updates available");
    expect(facts({ state: "idle" }, status()).label).toBe("Not synced yet");
  });
});

describe("formatCountdown", () => {
  it("rounds to seconds, minutes and hours", () => {
    expect(formatCountdown(NOW + 400, NOW)).toBe("0 s");
    expect(formatCountdown(NOW + 29_600, NOW)).toBe("30 s");
    expect(formatCountdown(NOW + 90_000, NOW)).toBe("2 min");
    expect(formatCountdown(NOW + 2 * 3_600_000, NOW)).toBe("2 h");
    expect(formatCountdown(NOW - 5_000, NOW)).toBe("0 s");
  });
});

describe("describeSync in Russian", () => {
  it("translates labels and plural details", () => {
    setLocale("ru");
    try {
      const view = facts({ state: "offline" }, status({ ahead: 3 }));
      expect(view.label).toBe("Нет сети");
      expect(view.detail).toContain("3 коммита ждут отправки");
      expect(formatCountdown(NOW + 90_000, NOW)).toBe("2 мин");
    } finally {
      setLocale("en");
    }
  });
});
