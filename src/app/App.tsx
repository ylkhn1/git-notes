import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { createDebouncer } from "@/lib/debounce";
import { useT, watchSystemLanguage } from "@/lib/i18n";
import { isMobile } from "@/lib/platform";
import { errorMessage } from "@/lib/result";
import { Button } from "@/ui/button";
import { TooltipProvider } from "@/ui/tooltip";

import { installShortcuts } from "@/features/commands/registry";
import { useEditorStore } from "@/features/editor/store";
import { useNotebooksStore } from "@/features/notebooks/store";
import { Welcome } from "@/features/notebooks/Welcome";
import { useLinksStore } from "@/features/links/store";
import { useSearchStore } from "@/features/search/store";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { useSettingsStore } from "@/features/settings/store";
import { watchSystemTheme } from "@/features/settings/theme";
import { ShareImport } from "@/features/share/ShareImport";
import { AppDialogs } from "@/features/shell/AppDialogs";
import { DesktopShell } from "@/features/shell/DesktopShell";
import { MobileShell } from "@/features/shell/MobileShell";
import { startSyncEvents, useSyncStore } from "@/features/sync/store";
import { startTreeSync } from "@/features/tree/store";
import { startUpdateChecks } from "@/features/updates/store";

const statusRefresh = createDebouncer(1000);

type Boot = { phase: "loading" } | { phase: "ready" } | { phase: "error"; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: "loading" });
  const notebook = useNotebooksStore((s) => s.current);
  const notebookCount = useNotebooksStore((s) => s.notebooks.length);
  const notebooksStatus = useNotebooksStore((s) => s.status);
  const onboardingComplete = useSettingsStore((s) => s.settings.onboardingComplete);

  useEffect(() => {
    const run = { cancelled: false };
    let stopTreeSync: (() => void) | undefined;
    let stopSyncEvents: (() => void) | undefined;
    const stopTheme = watchSystemTheme(() => useSettingsStore.getState().settings.theme);
    const stopLanguage = watchSystemLanguage(() => useSettingsStore.getState().settings.language);

    (async () => {
      try {
        await useSettingsStore.getState().load();
        stopTreeSync = await startTreeSync((paths) => {
          void useEditorStore.getState().externalChanges(paths);
          useLinksStore.getState().markStale();
          useSearchStore.getState().refreshSoon();
          statusRefresh.schedule("status", () => {
            const sync = useSyncStore.getState();
            void sync.refreshStatus();
            void sync.refreshConflicts();
          });
        });
        stopSyncEvents = await startSyncEvents();
        await useNotebooksStore.getState().load();
        if (!run.cancelled) setBoot({ phase: "ready" });
      } catch (error) {
        if (!run.cancelled) setBoot({ phase: "error", message: errorMessage(error) });
      }
    })().catch(() => undefined);

    // Flush pending autosaves when the window goes away; sync when it comes back
    // (window focus on desktop, activity resume on Android).
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void useEditorStore.getState().saveAll();
      } else {
        void useSyncStore.getState().requestSync("focus");
      }
    };
    const onFocus = () => {
      void useSyncStore.getState().requestSync("focus");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    const stopShortcuts = installShortcuts();
    const stopUpdateChecks = startUpdateChecks();

    return () => {
      run.cancelled = true;
      stopTheme();
      stopLanguage();
      stopTreeSync?.();
      stopSyncEvents?.();
      stopShortcuts();
      stopUpdateChecks();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Anyone with a notebook is past the first-run flow; remember that so it never shows.
  useEffect(() => {
    if (boot.phase !== "ready" || onboardingComplete) return;
    if (notebook || (notebooksStatus === "ready" && notebookCount > 0)) {
      void useSettingsStore.getState().update({ onboardingComplete: true });
    }
  }, [boot.phase, onboardingComplete, notebook, notebooksStatus, notebookCount]);

  const notebooksPending =
    !onboardingComplete && (notebooksStatus === "idle" || notebooksStatus === "loading");
  const firstRun = !onboardingComplete && notebooksStatus === "ready" && notebookCount === 0;

  return (
    <TooltipProvider>
      {boot.phase === "loading" && <Splash />}
      {boot.phase === "error" && <BootError message={boot.message} />}
      {boot.phase === "ready" &&
        (notebook ? (
          isMobile ? (
            <MobileShell />
          ) : (
            <DesktopShell />
          )
        ) : notebooksPending ? (
          <Splash />
        ) : firstRun ? (
          <Onboarding />
        ) : (
          <Welcome />
        ))}
      {boot.phase === "ready" && (
        <>
          <AppDialogs />
          <ShareImport />
        </>
      )}
    </TooltipProvider>
  );
}

function Splash() {
  const t = useT();
  return (
    <div
      data-tauri-drag-region
      className="flex h-full items-center justify-center"
      aria-busy="true"
      aria-label={t("app.starting")}
    >
      <div className="size-2 animate-pulse rounded-full bg-accent" />
    </div>
  );
}

function BootError({ message }: { message: string }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertTriangle className="size-8 text-danger" aria-hidden="true" />
      <p className="font-medium">{t("app.couldNotStart")}</p>
      <p className="selectable max-w-sm text-sm text-muted-text">{message}</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
