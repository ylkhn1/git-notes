import {
  Check,
  Download,
  Info,
  KeyRound,
  Monitor,
  Moon,
  RefreshCw,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useBackClose } from "@/lib/back-stack";
import { type AppInfo, commands, type EditorFont, type ThemeMode } from "@/lib/bindings";
import { errorMessage, unwrap } from "@/lib/result";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Switch } from "@/ui/switch";

import { isMobile } from "@/lib/platform";
import { type SettingsSection, useUiStore } from "@/features/shell/ui-store";
import { CredentialsBody } from "@/features/sync/CredentialsDialog";
import { RELEASES_URL, useUpdateStore } from "@/features/updates/store";

import { useSettingsStore } from "./store";

const sections: { id: SettingsSection; label: string; icon: typeof Sun }[] = [
  { id: "appearance", label: "Appearance", icon: SlidersHorizontal },
  { id: "sync", label: "Sync & identity", icon: RefreshCw },
  { id: "credentials", label: "Credentials", icon: KeyRound },
  { id: "about", label: "About", icon: Info },
];

/** All app-wide settings in one place; per-notebook remote setup stays in the sync menu. */
export function SettingsDialog() {
  const open = useUiStore((s) => s.dialog === "settings");
  const section = useUiStore((s) => s.settingsSection);
  const close = useUiStore((s) => s.closeDialog);
  const select = (next: SettingsSection) => useUiStore.setState({ settingsSection: next });
  useBackClose(open, close);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "h-full max-h-full w-full max-w-full rounded-none" : "h-[70vh] sm:max-w-3xl",
        )}
      >
        <DialogHeader className="border-b border-line px-5 py-3">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Apply to every notebook on this device.</DialogDescription>
        </DialogHeader>
        <div className={cn("flex min-h-0 flex-1", isMobile ? "flex-col" : "")}>
          <nav
            aria-label="Settings sections"
            className={cn(
              "shrink-0",
              isMobile
                ? "flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5"
                : "w-48 border-r border-line p-2",
            )}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-current={s.id === section ? "page" : undefined}
                onClick={() => select(s.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md text-sm hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isMobile ? "h-9 shrink-0 px-3" : "h-8 w-full px-2 text-left",
                  s.id === section ? "bg-accent-soft text-text" : "text-muted-text",
                )}
              >
                <s.icon className="size-4 shrink-0" aria-hidden="true" />
                {s.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {section === "appearance" && <AppearanceSection />}
            {section === "sync" && <SyncSection />}
            {section === "credentials" && (
              <div className="space-y-6">
                <CredentialsBody />
              </div>
            )}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-text">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: typeof Sun; className?: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-line p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            isMobile ? "h-10" : "h-7",
            o.value === value ? "bg-accent-soft text-text" : "text-muted-text hover:text-text",
            o.className,
          )}
        >
          {o.icon && <o.icon className="size-3.5" aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AppearanceSection() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  return (
    <div className="divide-y divide-line">
      <Row label="Theme" hint="System follows the OS setting.">
        <Segmented<ThemeMode>
          label="Theme"
          value={settings.theme}
          onChange={(theme) => void update({ theme })}
          options={[
            { value: "system", label: "System", icon: Monitor },
            { value: "light", label: "Light", icon: Sun },
            { value: "dark", label: "Dark", icon: Moon },
          ]}
        />
      </Row>
      <Row label="Editor font" hint="Body text of notes. Code always uses the monospace font.">
        <Segmented<EditorFont>
          label="Editor font"
          value={settings.editorFont}
          onChange={(editorFont) => void update({ editorFont })}
          options={[
            { value: "sans", label: "Sans", className: "font-editor-sans" },
            { value: "serif", label: "Serif", className: "font-editor-serif" },
            { value: "mono", label: "Mono", className: "font-mono" },
          ]}
        />
      </Row>
      <Row label="Text size" hint="12–32 px.">
        <Button
          variant="outline"
          size={isMobile ? "icon-lg" : "icon-sm"}
          aria-label="Smaller text"
          onClick={() => void update({ editorFontSize: Math.max(12, settings.editorFontSize - 1) })}
        >
          −
        </Button>
        <span className="w-12 text-center text-sm tabular-nums">{settings.editorFontSize} px</span>
        <Button
          variant="outline"
          size={isMobile ? "icon-lg" : "icon-sm"}
          aria-label="Larger text"
          onClick={() => void update({ editorFontSize: Math.min(32, settings.editorFontSize + 1) })}
        >
          +
        </Button>
      </Row>
    </div>
  );
}

function SyncSection() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [authorName, setAuthorName] = useState(settings.authorName);
  const [authorEmail, setAuthorEmail] = useState(settings.authorEmail);
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  const [delay, setDelay] = useState(String(settings.autoSyncDelaySecs));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), email: useId(), device: useId(), delay: useId(), auto: useId() };

  const dirty =
    authorName !== settings.authorName ||
    authorEmail !== settings.authorEmail ||
    deviceName !== settings.deviceName ||
    delay !== String(settings.autoSyncDelaySecs);

  const save = async () => {
    setError(null);
    try {
      const parsed = Number.parseInt(delay, 10);
      await update({
        authorName,
        authorEmail,
        deviceName,
        autoSyncDelaySecs: Number.isFinite(parsed) ? parsed : settings.autoSyncDelaySecs,
      });
      const next = useSettingsStore.getState().settings;
      setAuthorName(next.authorName);
      setAuthorEmail(next.authorEmail);
      setDeviceName(next.deviceName);
      setDelay(String(next.autoSyncDelaySecs));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [saved]);

  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="divide-y divide-line">
        <Row
          label="Automatic sync"
          hint="After you stop editing, when the app regains focus, with retries while offline."
        >
          <Switch
            id={ids.auto}
            aria-label="Automatic sync"
            checked={settings.autoSync}
            onCheckedChange={(autoSync) => void update({ autoSync })}
          />
        </Row>
        <Row label="Wait after the last change" hint="Seconds, 5–3600.">
          <Input
            id={ids.delay}
            type="number"
            inputMode="numeric"
            min={5}
            max={3600}
            step={5}
            className="w-24"
            value={delay}
            disabled={!settings.autoSync}
            onChange={(e) => setDelay(e.target.value)}
            aria-label="Seconds to wait after the last change"
          />
        </Row>
        <Row
          label="Also sync every"
          hint="Picks up changes from other devices while the app is open."
        >
          <div
            className={settings.autoSync ? undefined : "pointer-events-none opacity-50"}
            aria-disabled={!settings.autoSync}
          >
            <Segmented<string>
              label="Periodic sync interval"
              value={String(settings.periodicSyncMins)}
              onChange={(value) => void update({ periodicSyncMins: Number(value) })}
              options={[
                { value: "0", label: "Off" },
                { value: "5", label: "5 min" },
                { value: "15", label: "15 min" },
                { value: "30", label: "30 min" },
                { value: "60", label: "1 h" },
              ]}
            />
          </div>
        </Row>
      </div>

      <h3 className="pt-4 pb-1 text-2xs font-medium tracking-wide text-faint uppercase">
        Commit identity
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium text-muted-text" htmlFor={ids.name}>
          Author name
          <Input id={ids.name} value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-text" htmlFor={ids.email}>
          Author email
          <Input
            id={ids.email}
            type="email"
            autoCapitalize="off"
            value={authorEmail}
            onChange={(e) => setAuthorEmail(e.target.value)}
          />
        </label>
      </div>
      <label
        className="block space-y-1.5 pt-2 text-xs font-medium text-muted-text"
        htmlFor={ids.device}
      >
        Device name
        <Input id={ids.device} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        <span className="block font-normal text-faint">
          Used in commit messages (“sync: 3 files from {deviceName.trim() || "device"}”) and in
          conflict copy names.
        </span>
      </label>

      {error && (
        <p role="alert" className="pt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 pt-3">
        <Button type="submit" disabled={!dirty}>
          Save
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-success" role="status">
            <Check className="size-3.5" aria-hidden="true" /> Saved
          </span>
        )}
      </div>
    </form>
  );
}

function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    unwrap(commands.getAppInfo())
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">git-notes</h3>
        <p className="text-sm text-muted-text">
          Plain Markdown files in a folder, synced with git across your devices.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {info ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-text">Version</dt>
          <dd className="selectable">
            {info.version}
            {info.debug ? " (debug)" : ""}
          </dd>
          <dt className="text-muted-text">Platform</dt>
          <dd className="selectable">
            {info.platform} · {info.arch}
          </dd>
          <dt className="text-muted-text">This device</dt>
          <dd className="selectable">{info.deviceName}</dd>
          <dt className="text-muted-text">libgit2</dt>
          <dd className="selectable">{info.libgit2Version}</dd>
          <dt className="text-muted-text">Source</dt>
          <dd className="selectable">github.com/ylkhn1/git-notes</dd>
          <dt className="text-muted-text">Releases</dt>
          <dd className="selectable">{RELEASES_URL.replace("https://", "")}</dd>
        </dl>
      ) : (
        !error && (
          <div className="space-y-2" aria-busy="true" aria-label="Loading">
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
          </div>
        )
      )}
      {!isMobile && <UpdatesBlock />}
      <p className="text-xs text-faint">
        Secrets live in the system credential store; config files only hold references. Your notes
        never leave the git remotes you configure.
      </p>
    </div>
  );
}

/** Desktop only: the in-app updater (GitHub Releases) and its automatic check. */
function UpdatesBlock() {
  const checkUpdates = useSettingsStore((s) => s.settings.checkUpdates);
  const update = useSettingsStore((s) => s.update);
  const phase = useUpdateStore((s) => s.phase);
  const info = useUpdateStore((s) => s.info);
  const error = useUpdateStore((s) => s.error);
  const errorStep = useUpdateStore((s) => s.errorStep);
  const check = useUpdateStore((s) => s.check);
  const openDialog = useUiStore((s) => s.openDialog);
  const id = useId();

  const status = (() => {
    switch (phase) {
      case "checking":
        return "Checking…";
      case "upToDate":
        return "You have the latest version.";
      case "available":
        return info ? `Version ${info.version} is available.` : null;
      case "downloading":
        return "Downloading…";
      case "installed":
        return info ? `Version ${info.version} is installed; restart to finish.` : null;
      case "error":
        return `Could not ${errorStep === "install" ? "install" : "check"}: ${error ?? "unknown error"}`;
      default:
        return "Not checked yet.";
    }
  })();

  return (
    <div className="divide-y divide-line border-t border-line">
      <Row
        label="Check for updates automatically"
        hint="On start-up and every 6 hours, from GitHub Releases."
      >
        <Switch
          id={id}
          aria-label="Check for updates automatically"
          checked={checkUpdates}
          onCheckedChange={(value) => void update({ checkUpdates: value })}
        />
      </Row>
      <Row label="Updates" hint={status ?? undefined}>
        {phase === "available" || phase === "installed" ? (
          <Button size="sm" onClick={() => openDialog("update")}>
            <Download data-icon="inline-start" /> {phase === "installed" ? "Restart…" : "Install…"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={phase === "checking" || phase === "downloading"}
            onClick={() => void check()}
          >
            Check now
          </Button>
        )}
      </Row>
    </div>
  );
}
