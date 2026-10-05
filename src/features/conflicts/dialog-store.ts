import { create } from "zustand";

interface ConflictsDialogState {
  open: boolean;
  /** Copy to show first when the dialog opens, if any. */
  initialCopy: string | null;
  show: (copy?: string) => void;
  hide: () => void;
}

/** The conflicts dialog is opened from the banner and from the sync menu; one store owns it. */
export const useConflictsDialog = create<ConflictsDialogState>((set) => ({
  open: false,
  initialCopy: null,
  show: (copy) => set({ open: true, initialCopy: copy ?? null }),
  hide: () => set({ open: false }),
}));

/** `2026-10-02 1432` → `2026-10-02 14:32` (a trailing counter is kept). */
export function formatStamp(stamp: string): string {
  return stamp.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})/, "$1 $2:$3");
}
