import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import { copyText } from "@/lib/clipboard";
import { commands, type CredentialsInfo } from "@/lib/bindings";
import { errorMessage, unwrap } from "@/lib/result";
import { formatDateTime } from "@/lib/time";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** SSH key, HTTPS tokens and remembered host keys. Secrets never reach this component. */
export function CredentialsDialog({ open, onOpenChange }: Props) {
  useBackClose(open, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-line px-6 py-4">
          <DialogTitle>Credentials</DialogTitle>
          <DialogDescription>
            Stored in the system credential store, never in config files.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 px-6 py-4">
            <CredentialsBody />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsBody() {
  const [info, setInfo] = useState<CredentialsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setInfo(await unwrap(commands.getCredentials()));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    unwrap(commands.getCredentials())
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error && !info) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!info) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading credentials">
        <div className="h-20 animate-pulse rounded-md bg-surface-2" />
        <div className="h-12 animate-pulse rounded-md bg-surface-2" />
      </div>
    );
  }

  return (
    <>
      {!info.secretStore.available && (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          The system credential store is unavailable: {info.secretStore.error ?? "unknown error"}.{" "}
          On Linux install a Secret Service provider (KWallet or GNOME Keyring) and sign in again.
        </p>
      )}
      <SshKeySection info={info} onChanged={reload} />
      <TokensSection info={info} onChanged={reload} />
      {info.knownHosts.length > 0 && <KnownHostsSection info={info} onChanged={reload} />}
      <p className="text-xs text-faint">Store: {info.secretStore.backend}</p>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium tracking-wide text-muted-text uppercase">{children}</h3>
  );
}

function SshKeySection({
  info,
  onChanged,
}: {
  info: CredentialsInfo;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"regenerate" | "delete" | null>(null);
  const key = info.sshKey;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!key) return;
    try {
      await copyText(key.publicKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="space-y-2">
      <SectionTitle>SSH key</SectionTitle>
      {key ? (
        <div className="space-y-2 rounded-md border border-line bg-surface p-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <KeyRound className="size-4 shrink-0 text-accent" aria-hidden="true" />
            <span className="shrink-0 font-medium">ed25519</span>
            <span
              className="min-w-0 truncate font-mono text-xs text-muted-text"
              title={key.fingerprint}
            >
              {key.fingerprint}
            </span>
          </div>
          <textarea
            readOnly
            value={key.publicKey}
            rows={3}
            aria-label="Public key"
            onFocus={(e) => e.currentTarget.select()}
            className="selectable w-full resize-none rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-xs leading-relaxed break-all text-text"
          />
          <p className="text-xs text-faint">
            Created {formatDateTime(key.createdMs)}. Add this public key to your git host (GitHub:
            Settings → SSH keys, or a deploy key with write access).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void copy()}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "Copied" : "Copy public key"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm("regenerate")}
            >
              Regenerate
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirm("delete")}
            >
              <Trash2 data-icon="inline-start" /> Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-dashed border-line p-3 text-sm">
          <p className="text-muted-text">
            No key yet. Generate one for this device and add the public key to your git host.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={busy || !info.secretStore.available}
            onClick={() => void run(() => unwrap(commands.generateSshKey()))}
          >
            <KeyRound data-icon="inline-start" /> Generate key
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete" ? "Delete the SSH key?" : "Replace the SSH key?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Remotes that trust the current public key will stop accepting this device until you
              add the new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                void run(() =>
                  action === "delete"
                    ? unwrap(commands.deleteSshKey())
                    : unwrap(commands.generateSshKey()),
                );
              }}
            >
              {confirm === "delete" ? "Delete" : "Regenerate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function TokensSection({
  info,
  onChanged,
}: {
  info: CredentialsInfo;
  onChanged: () => Promise<void>;
}) {
  const [host, setHost] = useState("github.com");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { host: useId(), user: useId(), token: useId() };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(commands.saveHttpsToken(host, username, token));
      setToken("");
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await unwrap(commands.deleteHttpsToken(id));
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="space-y-2">
      <SectionTitle>HTTPS tokens</SectionTitle>
      {info.httpsTokens.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {info.httpsTokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.host}</div>
                <div className="truncate text-xs text-faint">
                  {t.username || "any user"} · saved {formatDateTime(t.createdMs)}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete token for ${t.host}`}
                onClick={() => void remove(t.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2 rounded-md border border-dashed border-line p-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="space-y-1">
          <label htmlFor={ids.host} className="text-xs text-muted-text">
            Host
          </label>
          <Input
            id={ids.host}
            value={host}
            autoCapitalize="off"
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.user} className="text-xs text-muted-text">
            Username (optional)
          </label>
          <Input
            id={ids.user}
            value={username}
            autoCapitalize="off"
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={ids.token} className="text-xs text-muted-text">
            Personal access token
          </label>
          <Input
            id={ids.token}
            type="password"
            value={token}
            autoComplete="off"
            placeholder="needs repository read/write access"
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            size="sm"
            disabled={busy || token.trim() === "" || !info.secretStore.available}
          >
            Save token
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function KnownHostsSection({
  info,
  onChanged,
}: {
  info: CredentialsInfo;
  onChanged: () => Promise<void>;
}) {
  return (
    <section className="space-y-2">
      <SectionTitle>Known SSH hosts</SectionTitle>
      <ul className="divide-y divide-line rounded-md border border-line bg-surface">
        {info.knownHosts.map((h) => (
          <li key={h.host} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{h.host}</div>
              <div className="truncate font-mono text-xs text-faint" title={h.fingerprint}>
                {h.keyType} {h.fingerprint}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void unwrap(commands.forgetHostKey(h.host)).then(onChanged);
              }}
            >
              Forget
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-faint">
        The first key a host presents is trusted and remembered; a different key later is rejected.
      </p>
    </section>
  );
}
