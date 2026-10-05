import { GitBranch } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import { commands, type CredentialsInfo } from "@/lib/bindings";
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
import { Switch } from "@/ui/switch";

import { useSettingsStore } from "@/features/settings/store";

import { parseRemoteUrl } from "./remote-url";
import { useSyncStore } from "./store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Remote URL plus commit identity for the current notebook. */
export function RemoteDialog({ open, onOpenChange }: Props) {
  useBackClose(open, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <RemoteForm onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RemoteForm({ onClose }: { onClose: () => void }) {
  const status = useSyncStore((s) => s.status);
  const settings = useSettingsStore((s) => s.settings);
  const [url, setUrl] = useState(status?.remoteUrl ?? "");
  const [authorName, setAuthorName] = useState(settings.authorName);
  const [authorEmail, setAuthorEmail] = useState(settings.authorEmail);
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  const [autoSync, setAutoSync] = useState(settings.autoSync);
  const [delay, setDelay] = useState(String(settings.autoSyncDelaySecs));
  const [credentials, setCredentials] = useState<CredentialsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = {
    url: useId(),
    name: useId(),
    email: useId(),
    device: useId(),
    auto: useId(),
    delay: useId(),
  };

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

  const isRepo = status?.isRepo ?? false;

  const initRepo = async () => {
    setBusy(true);
    setError(null);
    try {
      await useSyncStore.getState().initRepo();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = Number.parseInt(delay, 10);
      await useSettingsStore.getState().update({
        authorName,
        authorEmail,
        deviceName,
        autoSync,
        autoSyncDelaySecs: Number.isFinite(parsed) ? parsed : settings.autoSyncDelaySecs,
      });
      if (isRepo && url.trim() !== (status?.remoteUrl ?? "")) {
        await useSyncStore.getState().setRemoteUrl(url.trim() || null);
      }
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>Sync settings</DialogTitle>
        <DialogDescription>
          Where this notebook syncs to, when it syncs, and how your commits are signed.
        </DialogDescription>
      </DialogHeader>

      <div className="min-w-0 space-y-4">
        {!isRepo ? (
          <div className="flex items-start gap-3 rounded-md border border-line bg-surface-2 p-3 text-sm">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-2">
              <p>This folder is not a git repository yet. Initialize one to enable sync.</p>
              <Button type="button" size="sm" disabled={busy} onClick={() => void initRepo()}>
                Initialize git
              </Button>
            </div>
          </div>
        ) : (
          <Field
            id={ids.url}
            label="Remote URL"
            hint={<RemoteHint url={url} credentials={credentials} />}
          >
            <Input
              id={ids.url}
              value={url}
              placeholder="git@github.com:you/notes.git"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
            />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={ids.name} label="Author name">
            <Input
              id={ids.name}
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
            />
          </Field>
          <Field id={ids.email} label="Author email">
            <Input
              id={ids.email}
              type="email"
              value={authorEmail}
              autoCapitalize="off"
              onChange={(e) => setAuthorEmail(e.target.value)}
            />
          </Field>
        </div>
        <Field
          id={ids.device}
          label="Device name"
          hint={`Used in commit messages (“sync: 3 files from ${deviceName.trim() || "device"}”) and conflict copies.`}
        >
          <Input
            id={ids.device}
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
          />
        </Field>

        <div className="space-y-3 rounded-md border border-line p-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={ids.auto} className="text-sm">
              <span className="font-medium">Automatic sync</span>
              <span className="block text-xs text-muted-text">
                After you stop editing, when the app regains focus, and retries while offline.
              </span>
            </label>
            <Switch id={ids.auto} checked={autoSync} onCheckedChange={setAutoSync} />
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor={ids.delay} className="text-xs font-medium text-muted-text">
              Wait after the last change
            </label>
            <Input
              id={ids.delay}
              type="number"
              inputMode="numeric"
              min={5}
              max={3600}
              step={5}
              className="w-24"
              value={delay}
              disabled={!autoSync}
              onChange={(e) => setDelay(e.target.value)}
              aria-describedby={`${ids.delay}-unit`}
            />
            <span id={`${ids.delay}-unit`} className="text-xs text-faint">
              seconds (5–3600)
            </span>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-text">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs text-faint">{hint}</div>}
    </div>
  );
}

/** Which credential the URL will use, and whether it exists. */
export function RemoteHint({
  url,
  credentials,
}: {
  url: string;
  credentials: CredentialsInfo | null;
}) {
  const info = parseRemoteUrl(url);
  if (url.trim() === "") return <>Leave empty to keep this notebook local.</>;
  switch (info.transport) {
    case "ssh":
      return credentials?.sshKey ? (
        <>SSH · uses this device’s key ({credentials.sshKey.fingerprint.slice(0, 19)}…).</>
      ) : (
        <>
          SSH · no key yet — generate one under Credentials and add it to {info.host || "the host"}.
        </>
      );
    case "https":
    case "http": {
      const token = credentials?.httpsTokens.find((t) => t.host === info.host);
      return token ? (
        <>
          HTTPS · token for {info.host} saved{token.username ? ` (${token.username})` : ""}.
        </>
      ) : (
        <>
          HTTPS · no token saved for {info.host || "this host"} — needed to push (clone works for
          public repos).
        </>
      );
    }
    case "local":
      return <>Local path · no credentials needed.</>;
    default:
      return <span className="text-warning">Not a recognised git URL.</span>;
  }
}
