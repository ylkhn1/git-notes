import { CloudDownload } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import { commands, events, type CloneProgress, type CredentialsInfo } from "@/lib/bindings";
import { errorMessage, unwrap } from "@/lib/result";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";

import { useNotebooksStore } from "@/features/notebooks/store";

import { RemoteHint } from "./RemoteDialog";
import { repoNameFromUrl } from "./remote-url";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CloneDialog({ open, onOpenChange }: Props) {
  useBackClose(open, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <CloneForm onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CloneForm({ onClose }: { onClose: () => void }) {
  const defaultDir = useNotebooksStore((s) => s.defaultDir);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [credentials, setCredentials] = useState<CredentialsInfo | null>(null);
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { url: useId(), name: useId() };

  useEffect(() => {
    let cancelled = false;
    unwrap(commands.getCredentials())
      .then((info) => {
        if (!cancelled) setCredentials(info);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void events.cloneProgressEvent
      .listen((event) => {
        setProgress(event.payload.progress);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [busy]);

  const effectiveName = nameEdited ? name : repoNameFromUrl(url);

  const submit = async () => {
    if (url.trim() === "") {
      setError("Repository URL is required");
      return;
    }
    if (/[/\\]/.test(effectiveName)) {
      setError("Folder name cannot contain slashes");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await useNotebooksStore.getState().clone(url.trim(), effectiveName.trim() || null);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sep = defaultDir.includes("\\") ? "\\" : "/";

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Clone repository</DialogTitle>
        <DialogDescription>Open an existing notebook from a git remote.</DialogDescription>
      </DialogHeader>
      <div className="min-w-0 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={ids.url} className="text-xs font-medium text-muted-text">
            Repository URL
          </label>
          <Input
            id={ids.url}
            value={url}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            placeholder="git@github.com:you/notes.git"
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
          />
          <p className="text-xs text-faint">
            <RemoteHint url={url} credentials={credentials} />
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.name} className="text-xs font-medium text-muted-text">
            Folder name
          </label>
          <Input
            id={ids.name}
            value={effectiveName}
            disabled={busy}
            onChange={(e) => {
              setNameEdited(true);
              setName(e.target.value);
              setError(null);
            }}
          />
          <p
            className="truncate font-mono text-xs text-faint"
            title={`${defaultDir}${sep}${effectiveName}`}
          >
            {defaultDir}
            {sep}
            {effectiveName || "…"}
          </p>
        </div>

        {busy && <ProgressBar progress={progress} />}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          <CloudDownload data-icon="inline-start" /> {busy ? "Cloning…" : "Clone"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ProgressBar({ progress }: { progress: CloneProgress | null }) {
  let fraction: number | null = null;
  let text = "Connecting…";
  if (progress?.stage === "receiving" && progress.totalObjects > 0) {
    fraction = progress.receivedObjects / progress.totalObjects;
    text = `Receiving objects ${String(progress.receivedObjects)}/${String(progress.totalObjects)} · ${formatBytes(progress.receivedBytes)}`;
  } else if (progress?.stage === "checkout" && progress.checkoutTotal > 0) {
    fraction = progress.checkoutDone / progress.checkoutTotal;
    text = `Checking out files ${String(progress.checkoutDone)}/${String(progress.checkoutTotal)}`;
  }
  return (
    <div className="space-y-1" aria-live="polite">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
      >
        <div
          className={
            fraction === null
              ? "h-full w-1/3 animate-pulse bg-accent"
              : "h-full bg-accent transition-[width]"
          }
          style={
            fraction === null ? undefined : { width: `${String(Math.round(fraction * 100))}%` }
          }
        />
      </div>
      <p className="text-xs text-muted-text">{text}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
