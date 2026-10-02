import { GitBranch, Loader2, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { useAppInfoStore } from "@/features/app-info/store";

export function App() {
  const { status, info, error, load } = useAppInfoStore();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <header className="flex items-center gap-3">
        <GitBranch className="size-7 text-accent" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">git-notes</h1>
      </header>

      <section
        className="w-full max-w-sm rounded-md border border-border bg-surface-muted p-4 font-mono text-sm"
        aria-live="polite"
      >
        {status === "loading" && (
          <p className="flex items-center gap-2 text-foreground-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading app info…
          </p>
        )}
        {status === "error" && (
          <p className="flex items-start gap-2 text-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        {status === "ready" && info && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-foreground-muted">version</dt>
            <dd>{info.version}</dd>
            <dt className="text-foreground-muted">platform</dt>
            <dd>
              {info.platform}/{info.arch}
            </dd>
            <dt className="text-foreground-muted">device</dt>
            <dd>{info.deviceName}</dd>
            <dt className="text-foreground-muted">libgit2</dt>
            <dd>{info.libgit2Version}</dd>
            <dt className="text-foreground-muted">build</dt>
            <dd>{info.debug ? "debug" : "release"}</dd>
          </dl>
        )}
      </section>

      <p className="max-w-sm text-center text-sm text-foreground-muted">
        Phase 0 scaffold. The editor, file tree and sync arrive in the next phases.
      </p>
    </main>
  );
}
