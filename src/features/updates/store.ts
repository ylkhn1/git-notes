import { Channel } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

import { type ApkDownloadEvent, commands } from "@/lib/bindings";
import { isAndroid, isMobile } from "@/lib/platform";
import { errorMessage, unwrap } from "@/lib/result";

import { useEditorStore } from "@/features/editor/store";
import { useSettingsStore } from "@/features/settings/store";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  /** Desktop: installed, a restart finishes the update. */
  | "installed"
  /** Android: the APK is downloaded and handed (or about to be handed) to the system installer. */
  | "readyToInstall"
  | "error";

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
  /** Android: the system asks the user to allow git-notes to install apps first. */
  needsPermission: boolean;
  error: string | null;
  /** Which step failed. A failed background check is not shown in the banner. */
  errorStep: "check" | "install" | null;
  checkedAt: number | null;
  /** Version the user dismissed the banner for (this session). */
  dismissed: string | null;

  check: () => Promise<void>;
  install: () => Promise<void>;
  /** Desktop: saves open notes, then relaunches into the installed version. */
  restart: () => Promise<void>;
  /**
   * Android: opens the system installer for the downloaded APK. `openSettings` opens the
   * "install unknown apps" screen when that permission is still missing.
   */
  openInstaller: (openSettings: boolean) => Promise<void>;
  dismiss: () => void;
}

/** Where releases live; shown when the in-app install is not possible. */
export const RELEASES_URL = "https://github.com/ylkhn1/git-notes/releases";

/** Platforms that update themselves: desktop (updater plugin) and Android (APK). */
export const canSelfUpdate = !isMobile || isAndroid;

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The plugin's update handle: a Rust-side resource, so it stays out of the store state. */
let handle: Update | null = null;

async function findUpdate(): Promise<UpdateInfo | null> {
  if (isAndroid) return unwrap(commands.checkApkUpdate());
  const update = await checkForUpdate({ timeout: 30_000 });
  if (handle && handle !== update) void handle.close();
  handle = update;
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date ?? null,
    notes: update.body ?? null,
  };
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  phase: "idle",
  info: null,
  downloaded: 0,
  total: null,
  needsPermission: false,
  error: null,
  errorStep: null,
  checkedAt: null,
  dismissed: null,

  check: async () => {
    const { phase } = get();
    if (
      !canSelfUpdate ||
      phase === "checking" ||
      phase === "downloading" ||
      phase === "installed" ||
      phase === "readyToInstall"
    ) {
      return;
    }
    set({ phase: "checking", error: null, errorStep: null });
    try {
      const info = await findUpdate();
      set({ phase: info ? "available" : "upToDate", info, checkedAt: Date.now() });
    } catch (e) {
      set({ phase: "error", error: errorMessage(e), errorStep: "check", checkedAt: Date.now() });
    }
  },

  install: async () => {
    const { phase, errorStep, info } = get();
    const retrying = phase === "error" && errorStep === "install";
    if (!info || (phase !== "available" && !retrying)) return;
    if (!isAndroid && !handle) return;
    set({ phase: "downloading", downloaded: 0, total: null, error: null, errorStep: null });
    try {
      if (isAndroid) {
        const channel = new Channel<ApkDownloadEvent>();
        channel.onmessage = (event) => {
          if (event.event === "started") {
            set({ total: event.data.contentLength ?? null });
          } else {
            set({ downloaded: event.data.downloaded ?? 0 });
          }
        };
        // Installing replaces the running app, so nothing unsaved may be left behind.
        await useEditorStore.getState().saveAll();
        const outcome = await unwrap(commands.installApkUpdate(info.version, channel));
        // The system installer takes over from here and replaces the running app.
        set({ phase: "readyToInstall", needsPermission: outcome === "needsPermission" });
        return;
      }
      await handle?.downloadAndInstall((event) => {
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

  openInstaller: async (openSettings) => {
    if (get().phase !== "readyToInstall") return;
    try {
      await useEditorStore.getState().saveAll();
      const outcome = await unwrap(commands.launchApkInstaller(openSettings));
      set({ needsPermission: outcome === "needsPermission" });
    } catch (e) {
      set({ phase: "error", error: errorMessage(e), errorStep: "install" });
    }
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
    s.phase === "readyToInstall" ||
    (s.phase === "error" && s.errorStep === "install")
  );
}

/**
 * Background checks: shortly after start-up, every few hours, and when the app comes back
 * after a longer break (Android suspends timers in the background), while the setting is on.
 * Release builds on desktop and Android only; returns the stop function.
 */
export function startUpdateChecks(): () => void {
  if (!canSelfUpdate || import.meta.env.DEV) return () => undefined;
  const tick = () => {
    if (useSettingsStore.getState().settings.checkUpdates) void useUpdateStore.getState().check();
  };
  const onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    const { checkedAt, phase, needsPermission, openInstaller } = useUpdateStore.getState();
    // Back from the "install unknown apps" screen: continue with the installer.
    if (phase === "readyToInstall" && needsPermission) {
      void openInstaller(false);
      return;
    }
    if (checkedAt !== null && Date.now() - checkedAt >= CHECK_INTERVAL_MS) tick();
  };
  const first = setTimeout(tick, FIRST_CHECK_DELAY_MS);
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
