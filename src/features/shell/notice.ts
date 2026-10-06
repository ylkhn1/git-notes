import { create } from "zustand";

export interface Notice {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface NoticeState {
  notice: Notice | null;
  show: (text: string, tone?: Notice["tone"]) => void;
  dismiss: () => void;
}

const SHOW_MS = 5000;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;

/** One short message at the bottom of the window (errors of background actions, hints). */
export const useNoticeStore = create<NoticeState>((set) => ({
  notice: null,
  show: (text, tone = "info") => {
    clearTimeout(timer);
    const id = nextId++;
    set({ notice: { id, text, tone } });
    timer = setTimeout(() => {
      set((s) => (s.notice?.id === id ? { notice: null } : s));
    }, SHOW_MS);
  },
  dismiss: () => {
    clearTimeout(timer);
    set({ notice: null });
  },
}));

export function notify(text: string, tone: Notice["tone"] = "info") {
  useNoticeStore.getState().show(text, tone);
}
