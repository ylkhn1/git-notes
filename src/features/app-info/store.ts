import { create } from "zustand";

import { commands, type AppInfo } from "@/lib/bindings";
import { describeError } from "@/lib/errors";

type Status = "idle" | "loading" | "ready" | "error";

interface AppInfoState {
  status: Status;
  info: AppInfo | null;
  error: string | null;
  load: () => Promise<void>;
}

export const useAppInfoStore = create<AppInfoState>((set) => ({
  status: "idle",
  info: null,
  error: null,
  load: async () => {
    set({ status: "loading", error: null });
    const result = await commands.getAppInfo();
    if (result.status === "ok") {
      set({ status: "ready", info: result.data });
    } else {
      set({ status: "error", error: describeError(result.error) });
    }
  },
}));
