import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { createDebouncer } from "@/lib/debounce";
import { isMobile } from "@/lib/platform";
import { errorMessage } from "@/lib/result";
import { Button } from "@/ui/button";
import { TooltipProvider } from "@/ui/tooltip";

import { useEditorStore } from "@/features/editor/store";
import { useNotebooksStore } from "@/features/notebooks/store";
import { Welcome } from "@/features/notebooks/Welcome";
import { useSettingsStore } from "@/features/settings/store";
import { watchSystemTheme } from "@/features/settings/theme";
import { DesktopShell } from "@/features/shell/DesktopShell";
import { MobileShell } from "@/features/shell/MobileShell";
import { startSyncEvents, useSyncStore } from "@/features/sync/store";
import { startTreeSync } from "@/features/tree/store";

const statusRefresh = createDebouncer(1000);

type Boot = { phase: "loading" } | { phase: "ready" } | { phase: "error"; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: "loading" });
  const notebook = useNotebooksStore((s) => s.current);

  useEffect(() => {
    const run = { cancelled: false };
    let stopTreeSync: (() => void) | undefined;
    let stopSyncEvents: (() => void) | undefined;
    const stopTheme = watchSystemTheme(() => useSettingsStore.getState().settings.theme);

    (async () => {
      try {
        await useSettingsStore.getState().load();
        stopTreeSync = await startTreeSync((paths) => {
          void useEditorStore.getState().externalChanges(paths);
          statusRefresh.schedule("status", () => {
            void useSyncStore.getState().refreshStatus();
          });
        });
        stopSyncEvents = await startSyncEvents();
        await useNotebooksStore.getState().load();
        if (!run.cancelled) setBoot({ phase: "ready" });
      } catch (error) {
        if (!run.cancelled) setBoot({ phase: "error", message: errorMessage(error) });
      }
    })().catch(() => undefined);

    // Flush pending autosaves when the window is about to go away.
    const onHide = () => {
      if (document.visibilityState === "hidden") void useEditorStore.getState().saveAll();
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      run.cancelled = true;
      stopTheme();
      stopTreeSync?.();
      stopSyncEvents?.();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return (
    <TooltipProvider>
      {boot.phase === "loading" && <Splash />}
      {boot.phase === "error" && <BootError message={boot.message} />}
      {boot.phase === "ready" &&
        (notebook ? isMobile ? <MobileShell /> : <DesktopShell /> : <Welcome />)}
    </TooltipProvider>
  );
}

function Splash() {
  return (
    <div
      data-tauri-drag-region
      className="flex h-full items-center justify-center"
      aria-busy="true"
      aria-label="Starting"
    >
      <div className="size-2 animate-pulse rounded-full bg-accent" />
    </div>
  );
}

function BootError({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertTriangle className="size-8 text-danger" aria-hidden="true" />
      <p className="font-medium">git-notes could not start</p>
      <p className="selectable max-w-sm text-sm text-muted-text">{message}</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        Retry
      </Button>
    </div>
  );
}
