import { create } from "zustand";

import { commands, type Settings } from "@/lib/bindings";
import { unwrap } from "@/lib/result";

import { applyEditorFont, applyTheme } from "./theme";

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  /** Applies the patch locally at once and persists it in the background. */
  update: (patch: Partial<Settings>) => Promise<void>;
}

export const defaultSettings: Settings = {
  theme: "system",
  editorFont: "sans",
  editorFontSize: 17,
  sidebarWidth: 260,
  lastNotebookId: null,
  authorName: "",
  authorEmail: "",
  deviceName: "",
  autoSync: true,
  autoSyncDelaySecs: 30,
  periodicSyncMins: 15,
  checkUpdates: true,
  onboardingComplete: false,
};

function applyAll(settings: Settings) {
  applyTheme(settings.theme);
  applyEditorFont(settings.editorFont, settings.editorFontSize);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  load: async () => {
    const settings = await unwrap(commands.getSettings());
    applyAll(settings);
    set({ settings, loaded: true });
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    applyAll(next);
    set({ settings: next });
    const saved = await unwrap(commands.updateSettings(next));
    // The backend clamps values; mirror whatever it kept.
    set({ settings: saved });
    applyAll(saved);
  },
}));
