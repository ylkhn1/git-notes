import { create } from "zustand";

/** Global dialogs; one open at a time. */
export type DialogName =
  | "none"
  | "remote"
  | "credentials"
  | "history"
  | "newNotebook"
  | "clone"
  | "settings"
  | "shortcuts"
  | "update";

export type PaletteMode = "commands" | "files" | "search";

export type SettingsSection = "appearance" | "sync" | "credentials" | "about";

interface UiState {
  dialog: DialogName;
  settingsSection: SettingsSection;
  /** The command palette / quick switcher / search overlay, or null when closed. */
  palette: PaletteMode | null;
  openDialog: (dialog: DialogName, options?: { section?: SettingsSection }) => void;
  closeDialog: () => void;
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
}

/**
 * Owns which overlay is open so that commands (palette, shortcuts) can open any dialog
 * without the component that renders it being nearby.
 */
export const useUiStore = create<UiState>((set) => ({
  dialog: "none",
  settingsSection: "appearance",
  palette: null,
  openDialog: (dialog, options) =>
    set((s) => ({
      dialog,
      palette: null,
      settingsSection: options?.section ?? s.settingsSection,
    })),
  closeDialog: () => set({ dialog: "none" }),
  openPalette: (mode) => set({ palette: mode, dialog: "none" }),
  closePalette: () => set({ palette: null }),
}));
