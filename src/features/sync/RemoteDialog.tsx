import { GitBranch } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import { commands, type CredentialsInfo } from "@/lib/bindings";
import { useT } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
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

import { useUiStore } from "@/features/shell/ui-store";

import { parseRemoteUrl } from "./remote-url";
import { useSyncStore } from "./store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Git setup for the current notebook: initialize the repository and set its remote. */
export function RemoteDialog({ open, onOpenChange }: Props) {
  useBackClose(open, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <RemoteForm onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RemoteForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const status = useSyncStore((s) => s.status);
  const openDialog = useUiStore((s) => s.openDialog);
  const [url, setUrl] = useState(status?.remoteUrl ?? "");
  const [credentials, setCredentials] = useState<CredentialsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlId = useId();

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
        <DialogTitle>{t("remote.title")}</DialogTitle>
        <DialogDescription>{t("remote.description")}</DialogDescription>
      </DialogHeader>

      <div className="min-w-0 space-y-4">
        {!isRepo ? (
          <div className="flex items-start gap-3 rounded-md border border-line bg-surface-2 p-3 text-sm">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-2">
              <p>{t("remote.notARepoYet")}</p>
              <Button type="button" size="sm" disabled={busy} onClick={() => void initRepo()}>
                {t("remote.initializeGit")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={urlId} className="text-xs font-medium text-muted-text">
              {t("remote.remoteUrl")}
            </label>
            <Input
              id={urlId}
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
            <div className="text-xs text-faint">
              <RemoteHint url={url} credentials={credentials} />
            </div>
          </div>
        )}

        <p className="text-xs text-faint">
          {rich("remote.settingsNote", {
            link: (text) => (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-text"
                onClick={() => openDialog("settings", { section: "sync" })}
              >
                {text}
              </button>
            ),
          })}
        </p>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy || !isRepo}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
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
  const t = useT();
  const info = parseRemoteUrl(url);
  if (url.trim() === "") return <>{t("remote.hintKeepLocal")}</>;
  switch (info.transport) {
    case "ssh":
      return credentials?.sshKey ? (
        <>{t("remote.hintSshKey", { fingerprint: credentials.sshKey.fingerprint.slice(0, 19) })}</>
      ) : (
        <>{t("remote.hintSshNoKey", { host: info.host || t("remote.theHost") })}</>
      );
    case "https":
    case "http": {
      const token = credentials?.httpsTokens.find((tok) => tok.host === info.host);
      return token ? (
        <>
          {token.username
            ? t("remote.hintHttpsTokenUser", { host: info.host, username: token.username })
            : t("remote.hintHttpsToken", { host: info.host })}
        </>
      ) : (
        <>{t("remote.hintHttpsNoToken", { host: info.host || t("remote.thisHost") })}</>
      );
    }
    case "local":
      return <>{t("remote.hintLocalPath")}</>;
    default:
      return <span className="text-warning">{t("remote.hintNotGitUrl")}</span>;
  }
}
