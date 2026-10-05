import {
  AArrowDown,
  AArrowUp,
  Monitor,
  Moon,
  Settings,
  SlidersHorizontal,
  Sun,
} from "lucide-react";

import type { EditorFont, Language, ThemeMode } from "@/lib/bindings";
import { LOCALE_NAMES, type MessageKey, useT } from "@/lib/i18n";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

import { useUiStore } from "@/features/shell/ui-store";

import { useSettingsStore } from "./store";

const themes: { value: ThemeMode; label: MessageKey; icon: typeof Sun }[] = [
  { value: "system", label: "settings.themeSystem", icon: Monitor },
  { value: "light", label: "settings.themeLight", icon: Sun },
  { value: "dark", label: "settings.themeDark", icon: Moon },
];

const fonts: { value: EditorFont; label: string; sample: string }[] = [
  { value: "sans", label: "Sans", sample: "font-editor-sans" },
  { value: "serif", label: "Serif", sample: "font-editor-serif" },
  { value: "mono", label: "Mono", sample: "font-mono" },
];

/** Quick access to appearance settings: theme, editor font and text size. */
export function ViewMenu() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const openDialog = useUiStore((s) => s.openDialog);

  const bump = (delta: number) => {
    void update({ editorFontSize: Math.min(32, Math.max(12, settings.editorFontSize + delta)) });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("settings.appearance")}>
          <SlidersHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("settings.theme")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.theme}
          onValueChange={(value) => {
            void update({ theme: value as ThemeMode });
          }}
        >
          {themes.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon /> {t(label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("settings.editorFont")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.editorFont}
          onValueChange={(value) => {
            void update({ editorFont: value as EditorFont });
          }}
        >
          {fonts.map(({ value, label, sample }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <span className={`${sample} text-base`}>Ag</span> {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center justify-between">
          {t("settings.textSize")}{" "}
          <span className="font-mono text-xs text-muted-text">{settings.editorFontSize}px</span>
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            bump(-1);
          }}
        >
          <AArrowDown /> {t("settings.smaller")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            bump(1);
          }}
        >
          <AArrowUp /> {t("settings.larger")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("app.language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.language}
          onValueChange={(value) => {
            void update({ language: value as Language });
          }}
        >
          <DropdownMenuRadioItem value="system">{t("app.languageSystem")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">{LOCALE_NAMES.en}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="ru">{LOCALE_NAMES.ru}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openDialog("settings")}>
          <Settings /> {t("settings.allSettings")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
