import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

import { isMobile } from "@/lib/platform";
import { errorMessage } from "@/lib/result";

import { useEditorStore } from "@/features/editor/store";
import { useSettingsStore } from "@/features/settings/store";

export type UpdatePhase =
  "idle" | "checking" | "upToDate" | "available" | "downloading" | "installed" | "error";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** RFC 3339 publish date, when the manifest has one. */
  date: string | null;
  /** Release notes from the manifest. */
  notes: string | null;
}

interface UpdateState {
  phase: UpdatePhase;
  /** The announced update while one is known (available, downloading, installed, failed). */
  info: UpdateInfo | null;
  /** Download progress: bytes so far and the announced size. */
  downloaded: number;
  total: number | null;
  error: string | null;
  /** Which step failed. A failed background check is not shown in the banner. */
  errorStep: "check" | "install" | null;
  checkedAt: number | null;
  /** Version the user dismissed the banner for (this session). */
  dismissed: string | null;

  check: () => Promise<void>;
  install: () => Promise<void>;
  /** Saves open notes, then relaunches into the installed version. */
  restart: () => Promise<void>;
  dismiss: () => void;
}

/** Where releases live; shown when the in-app install is not possible. */
export const RELEASES_URL = "https://github.com/ylkhn1/git-notes/releases";

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The plugin's update handle: a Rust-side resource, so it stays out of the store state. */
let handle: Update | null = null;

export const useUpdateStore = create<UpdateState>((set, get) => ({
  phase: "idle",
  info: null,
  downloaded: 0,
  total: null,
  error: null,
  errorStep: null,
  checkedAt: null,
  dismissed: null,

  check: async () => {
    const { phase } = get();
    if (isMobile || phase === "checking" || phase === "downloading" || phase === "installed") {
      return;
    }
    set({ phase: "checking", error: null, errorStep: null });
    try {
      const update = await checkForUpdate({ timeout: 30_000 });
      if (handle && handle !== update) void handle.close();
      handle = update;
      if (!update) {
        set({ phase: "upToDate", info: null, checkedAt: Date.now() });
        return;
      }
      set({
        phase: "available",
        checkedAt: Date.now(),
        info: {
          version: update.version,
          currentVersion: update.currentVersion,
          date: update.date ?? null,
          notes: update.body ?? null,
        },
      });
    } catch (e) {
      set({ phase: "error", error: errorMessage(e), errorStep: "check", checkedAt: Date.now() });
    }
  },

  install: async () => {
    const { phase, errorStep } = get();
    const retrying = phase === "error" && errorStep === "install";
    if (!handle || (phase !== "available" && !retrying)) return;
    set({ phase: "downloading", downloaded: 0, total: null, error: null, errorStep: null });
    try {
      await handle.downloadAndInstall((event) => {
        if (event.event === "Started") {
          set({ total: event.data.contentLength ?? null });
        } else if (event.event === "Progress") {
          set((s) => ({ downloaded: s.downloaded + event.data.chunkLength }));
        }
      });
      // On Windows the installer has taken over by now; elsewhere a relaunch finishes it.
      set({ phase: "installed" });
    } catch (e) {
      set({ phase: "error", error: errorMessage(e), errorStep: "install" });
    }
  },

  restart: async () => {
    await useEditorStore.getState().saveAll();
    await relaunch();
  },

  dismiss: () => {
    set((s) => ({ dismissed: s.info?.version ?? s.dismissed }));
  },
}));

/** True when the banner should show the current update state. */
export function selectBannerVisible(s: UpdateState): boolean {
  if (!s.info || s.dismissed === s.info.version) return false;
  return (
    s.phase === "available" ||
    s.phase === "downloading" ||
    s.phase === "installed" ||
    (s.phase === "error" && s.errorStep === "install")
  );
}

/**
 * Background checks: shortly after start-up and every few hours, while the setting is on.
 * Desktop release builds only; returns the stop function.
 */
export function startUpdateChecks(): () => void {
  if (isMobile || import.meta.env.DEV) return () => undefined;
  const tick = () => {
    if (useSettingsStore.getState().settings.checkUpdates) void useUpdateStore.getState().check();
  };
  const first = setTimeout(tick, FIRST_CHECK_DELAY_MS);
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
