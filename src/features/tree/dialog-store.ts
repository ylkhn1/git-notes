import { create } from "zustand";

export type TreeDialog =
  | { kind: "none" }
  | { kind: "new-note"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "rename"; path: string }
  | { kind: "move"; path: string }
  | { kind: "delete"; path: string }
  | { kind: "actions"; path: string };

interface TreeDialogState {
  dialog: TreeDialog;
  open: (dialog: TreeDialog) => void;
  close: () => void;
}

/** Which tree dialog (or mobile action sheet) is open. Shared so toolbars can open them too. */
export const useTreeDialogStore = create<TreeDialogState>((set) => ({
  dialog: { kind: "none" },
  open: (dialog) => {
    set({ dialog });
  },
  close: () => {
    set({ dialog: { kind: "none" } });
  },
}));
