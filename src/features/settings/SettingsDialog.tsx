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
import {
  type AppInfo,
  commands,
  type EditorFont,
  type Language,
  type ThemeMode,
} from "@/lib/bindings";
import { LOCALE_NAMES, type MessageKey, useT } from "@/lib/i18n";
import { errorMessage, unwrap } from "@/lib/result";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Switch } from "@/ui/switch";

import { isMobile } from "@/lib/platform";
import { type SettingsSection, useUiStore } from "@/features/shell/ui-store";
import { CredentialsBody } from "@/features/sync/CredentialsDialog";
import { canSelfUpdate, RELEASES_URL, useUpdateStore } from "@/features/updates/store";

import { useSettingsStore } from "./store";

const sections: { id: SettingsSection; label: MessageKey; icon: typeof Sun }[] = [
  { id: "appearance", label: "settings.sectionAppearance", icon: SlidersHorizontal },
  { id: "sync", label: "settings.sectionSync", icon: RefreshCw },
  { id: "credentials", label: "settings.sectionCredentials", icon: KeyRound },
  { id: "about", label: "settings.sectionAbout", icon: Info },
];

/** All app-wide settings in one place; per-notebook remote setup stays in the sync menu. */
export function SettingsDialog() {
  const t = useT();
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
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        <div className={cn("flex min-h-0 flex-1", isMobile ? "flex-col" : "")}>
          <nav
            aria-label={t("settings.sections")}
            className={cn(
              "shrink-0",
              isMobile
                ? "flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5"
                : "w-60 border-r border-line p-2",
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
                  isMobile ? "h-9 shrink-0 px-3" : "h-8 w-full px-2 text-left whitespace-nowrap",
                  s.id === section ? "bg-accent-soft text-text" : "text-muted-text",
                )}
              >
                <s.icon className="size-4 shrink-0" aria-hidden="true" />
                {t(s.label)}
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
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  return (
    <div className="divide-y divide-line">
      <Row label={t("app.language")} hint={t("app.languageHint")}>
        <Segmented<Language>
          label={t("app.language")}
          value={settings.language}
          onChange={(language) => void update({ language })}
          options={[
            { value: "system", label: t("app.languageSystem") },
            { value: "en", label: LOCALE_NAMES.en },
            { value: "ru", label: LOCALE_NAMES.ru },
          ]}
        />
      </Row>
      <Row label={t("settings.theme")} hint={t("settings.themeHint")}>
        <Segmented<ThemeMode>
          label={t("settings.theme")}
          value={settings.theme}
          onChange={(theme) => void update({ theme })}
          options={[
            { value: "system", label: t("settings.themeSystem"), icon: Monitor },
            { value: "light", label: t("settings.themeLight"), icon: Sun },
            { value: "dark", label: t("settings.themeDark"), icon: Moon },
          ]}
        />
      </Row>
      <Row label={t("settings.editorFont")} hint={t("settings.editorFontHint")}>
        <Segmented<EditorFont>
          label={t("settings.editorFont")}
          value={settings.editorFont}
          onChange={(editorFont) => void update({ editorFont })}
          options={[
            { value: "sans", label: "Sans", className: "font-editor-sans" },
            { value: "serif", label: "Serif", className: "font-editor-serif" },
            { value: "mono", label: "Mono", className: "font-mono" },
          ]}
        />
      </Row>
      <Row label={t("settings.textSize")} hint={t("settings.textSizeHint")}>
        <Button
          variant="outline"
          size={isMobile ? "icon-lg" : "icon-sm"}
          aria-label={t("settings.smallerText")}
          onClick={() => void update({ editorFontSize: Math.max(12, settings.editorFontSize - 1) })}
        >
          −
        </Button>
        <span className="w-12 text-center text-sm tabular-nums">{settings.editorFontSize} px</span>
        <Button
          variant="outline"
          size={isMobile ? "icon-lg" : "icon-sm"}
          aria-label={t("settings.largerText")}
          onClick={() => void update({ editorFontSize: Math.min(32, settings.editorFontSize + 1) })}
        >
          +
        </Button>
      </Row>
    </div>
  );
}

function SyncSection() {
  const t = useT();
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
        <Row label={t("settings.automaticSync")} hint={t("settings.automaticSyncHint")}>
          <Switch
            id={ids.auto}
            aria-label={t("settings.automaticSync")}
            checked={settings.autoSync}
            onCheckedChange={(autoSync) => void update({ autoSync })}
          />
        </Row>
        <Row label={t("settings.waitAfterChange")} hint={t("settings.waitAfterChangeHint")}>
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
            aria-label={t("settings.waitAfterChangeLabel")}
          />
        </Row>
        <Row label={t("settings.alsoSyncEvery")} hint={t("settings.alsoSyncEveryHint")}>
          <div
            className={settings.autoSync ? undefined : "pointer-events-none opacity-50"}
            aria-disabled={!settings.autoSync}
          >
            <Segmented<string>
              label={t("settings.periodicInterval")}
              value={String(settings.periodicSyncMins)}
              onChange={(value) => void update({ periodicSyncMins: Number(value) })}
              options={[
                { value: "0", label: t("settings.periodicOff") },
                { value: "5", label: t("settings.periodicMinutes", { count: 5 }) },
                { value: "15", label: t("settings.periodicMinutes", { count: 15 }) },
                { value: "30", label: t("settings.periodicMinutes", { count: 30 }) },
                { value: "60", label: t("settings.periodicHour") },
              ]}
            />
          </div>
        </Row>
      </div>

      <h3 className="pt-4 pb-1 text-2xs font-medium tracking-wide text-faint uppercase">
        {t("settings.commitIdentity")}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium text-muted-text" htmlFor={ids.name}>
          {t("settings.authorName")}
          <Input id={ids.name} value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-text" htmlFor={ids.email}>
          {t("settings.authorEmail")}
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
        {t("settings.deviceName")}
        <Input id={ids.device} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        <span className="block font-normal text-faint">
          {t("settings.deviceNameHint", {
            device: deviceName.trim() || t("settings.deviceFallback"),
          })}
        </span>
      </label>

      {error && (
        <p role="alert" className="pt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 pt-3">
        <Button type="submit" disabled={!dirty}>
          {t("common.save")}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-success" role="status">
            <Check className="size-3.5" aria-hidden="true" /> {t("common.saved")}
          </span>
        )}
      </div>
    </form>
  );
}

function AboutSection() {
  const t = useT();
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
        <p className="text-sm text-muted-text">{t("settings.tagline")}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {info ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-text">{t("settings.version")}</dt>
          <dd className="selectable">
            {info.version}
            {info.debug ? ` ${t("settings.debug")}` : ""}
          </dd>
          <dt className="text-muted-text">{t("settings.platform")}</dt>
          <dd className="selectable">
            {info.platform} · {info.arch}
          </dd>
          <dt className="text-muted-text">{t("settings.thisDevice")}</dt>
          <dd className="selectable">{info.deviceName}</dd>
          <dt className="text-muted-text">libgit2</dt>
          <dd className="selectable">{info.libgit2Version}</dd>
          <dt className="text-muted-text">{t("settings.source")}</dt>
          <dd className="selectable">github.com/ylkhn1/git-notes</dd>
          <dt className="text-muted-text">{t("settings.releases")}</dt>
          <dd className="selectable">{RELEASES_URL.replace("https://", "")}</dd>
        </dl>
      ) : (
        !error && (
          <div className="space-y-2" aria-busy="true" aria-label={t("common.loading")}>
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
          </div>
        )
      )}
      {canSelfUpdate && <UpdatesBlock />}
      <p className="text-xs text-faint">{t("settings.secretsNote")}</p>
    </div>
  );
}

/** The in-app updater (GitHub Releases) and its automatic check: desktop and Android. */
function UpdatesBlock() {
  const t = useT();
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
        return t("settings.checking");
      case "upToDate":
        return t("settings.upToDate");
      case "available":
        return info ? t("settings.available", { version: info.version }) : null;
      case "downloading":
        return t("settings.downloading");
      case "installed":
        return info ? t("settings.installed", { version: info.version }) : null;
      case "readyToInstall":
        return info ? t("settings.readyToInstall", { version: info.version }) : null;
      case "error":
        return t(errorStep === "install" ? "settings.couldNotInstall" : "settings.couldNotCheck", {
          error: error ?? t("common.unknownError"),
        });
      default:
        return t("settings.notChecked");
    }
  })();

  return (
    <div className="divide-y divide-line border-t border-line">
      <Row label={t("settings.checkAutomatically")} hint={t("settings.checkAutomaticallyHint")}>
        <Switch
          id={id}
          aria-label={t("settings.checkAutomatically")}
          checked={checkUpdates}
          onCheckedChange={(value) => void update({ checkUpdates: value })}
        />
      </Row>
      <Row label={t("settings.updates")} hint={status ?? undefined}>
        {phase === "available" || phase === "installed" || phase === "readyToInstall" ? (
          <Button size="sm" onClick={() => openDialog("update")}>
            <Download data-icon="inline-start" />{" "}
            {phase === "installed" ? t("settings.restart") : t("settings.install")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={phase === "checking" || phase === "downloading"}
            onClick={() => void check()}
          >
            {t("settings.checkNow")}
          </Button>
        )}
      </Row>
    </div>
  );
}
