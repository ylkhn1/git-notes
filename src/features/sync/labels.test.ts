import { describe, expect, it } from "vitest";

import type { RepoStatus } from "@/lib/bindings";

import { describeSync } from "./labels";

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

describe("describeSync", () => {
  it("prefers repository facts over the sync state", () => {
    expect(describeSync({ state: "upToDate" }, status({ isRepo: false })).label).toBe(
      "Not a git repo",
    );
    expect(describeSync({ state: "upToDate" }, status({ remoteUrl: null })).label).toBe(
      "Local only",
    );
  });

  it("maps states to labels and tones", () => {
    expect(describeSync({ state: "syncing" }, status())).toMatchObject({
      label: "Syncing…",
      tone: "busy",
    });
    expect(describeSync({ state: "offline" }, status())).toMatchObject({ tone: "warn" });
    expect(describeSync({ state: "error", data: "boom" }, status())).toMatchObject({
      label: "Sync error",
      tone: "danger",
      detail: "boom",
    });
    expect(describeSync({ state: "conflict", data: ["a", "b"] }, status()).label).toBe(
      "2 conflict copies",
    );
    expect(describeSync({ state: "upToDate" }, status())).toMatchObject({
      label: "Up to date",
      tone: "ok",
    });
  });

  it("reports pending work", () => {
    expect(describeSync({ state: "upToDate" }, status({ dirtyFiles: 2, ahead: 1 }))).toMatchObject({
      label: "Changes to sync",
      detail: "2 uncommitted files, 1 commit to push",
    });
    expect(describeSync({ state: "idle" }, status({ behind: 3 })).label).toBe("Updates available");
    expect(describeSync({ state: "idle" }, status()).label).toBe("Not synced yet");
  });
});
