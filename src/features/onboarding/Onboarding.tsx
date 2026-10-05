import { ArrowLeft, CloudDownload, FolderOpen, GitBranch, Plus } from "lucide-react";
import { useId, useState } from "react";

import { isAndroid } from "@/lib/platform";
import { errorMessage } from "@/lib/result";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

import { useNotebooksStore } from "@/features/notebooks/store";
import { useSettingsStore } from "@/features/settings/store";
import { ViewMenu } from "@/features/settings/ViewMenu";
import { SharePendingNotice } from "@/features/share/ShareImport";
import { useUiStore } from "@/features/shell/ui-store";
import { UpdateBanner } from "@/features/updates/UpdateBanner";

type Step = "identity" | "notebook";

/**
 * First run: the commit identity, then the first notebook. Finishes on its own as soon as a
 * notebook is open (see `App`), or when the user skips it.
 */
export function Onboarding() {
  const [step, setStep] = useState<Step>("identity");
  const skip = () => {
    void useSettingsStore.getState().update({ onboardingComplete: true });
  };

  return (
    <main data-tauri-drag-region className="flex h-full flex-col overflow-y-auto">
      <UpdateBanner />
      <div data-tauri-drag-region className="flex shrink-0 justify-end p-2">
        <ViewMenu />
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-8 pb-8">
        <header className="space-y-2 text-center">
          <GitBranch className="mx-auto size-9 text-accent" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-tight">
            {step === "identity" ? "Welcome to git-notes" : "Your first notebook"}
          </h1>
          <p className="text-sm text-muted-text">
            {step === "identity"
              ? "Plain Markdown files in a folder, synced with git across your devices. Two quick questions first."
              : "A notebook is a folder of Markdown files that is also a git repository."}
          </p>
        </header>

        <SharePendingNotice />

        {step === "identity" ? (
          <IdentityStep
            onDone={() => {
              setStep("notebook");
            }}
          />
        ) : (
          <NotebookStep
            onBack={() => {
              setStep("identity");
            }}
          />
        )}

        <footer className="flex items-center justify-between text-xs text-faint">
          <span>Step {step === "identity" ? "1" : "2"} of 2</span>
          <button
            type="button"
            className="underline-offset-2 hover:text-text hover:underline"
            onClick={skip}
          >
            Skip for now
          </button>
        </footer>
      </div>
    </main>
  );
}

function IdentityStep({ onDone }: { onDone: () => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const [authorName, setAuthorName] = useState(settings.authorName);
  const [authorEmail, setAuthorEmail] = useState(settings.authorEmail);
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), email: useId(), device: useId() };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await useSettingsStore.getState().update({ authorName, authorEmail, deviceName });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium text-muted-text" htmlFor={ids.name}>
          Your name
          <Input
            id={ids.name}
            value={authorName}
            autoFocus={!isAndroid}
            autoComplete="name"
            onChange={(e) => setAuthorName(e.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-text" htmlFor={ids.email}>
          Email
          <Input
            id={ids.email}
            type="email"
            autoCapitalize="off"
            autoComplete="email"
            value={authorEmail}
            onChange={(e) => setAuthorEmail(e.target.value)}
          />
        </label>
      </div>
      <label className="block space-y-1.5 text-xs font-medium text-muted-text" htmlFor={ids.device}>
        This device
        <Input id={ids.device} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
      </label>
      <p className="text-xs text-faint">
        Every change becomes a git commit with this name and email. The device name tells your other
        devices where a change came from. You can edit all of this later in Settings.
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        Continue
      </Button>
    </form>
  );
}

function NotebookStep({ onBack }: { onBack: () => void }) {
  const openDialog = useUiStore((s) => s.openDialog);
  const [error, setError] = useState<string | null>(null);

  const openFolder = () => {
    setError(null);
    useNotebooksStore
      .getState()
      .openFolder()
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Choice
          icon={Plus}
          title="Create a new notebook"
          hint="An empty folder with a starter note. Connect a git remote later."
          onClick={() => openDialog("newNotebook")}
        />
        <Choice
          icon={CloudDownload}
          title="Clone an existing repository"
          hint="Your notes already live on GitHub, Gitea or an SSH server."
          onClick={() => openDialog("clone")}
        />
        {!isAndroid && (
          <Choice
            icon={FolderOpen}
            title="Open a folder"
            hint="Markdown files you already have. Git is optional until you add a remote."
            onClick={openFolder}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" /> Back
      </Button>
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: typeof Plus;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-md border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-text">{hint}</span>
      </span>
    </button>
  );
}
