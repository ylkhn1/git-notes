import { AArrowDown, AArrowUp, Monitor, Moon, SlidersHorizontal, Sun } from "lucide-react";

import type { EditorFont, ThemeMode } from "@/lib/bindings";
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

import { useSettingsStore } from "./store";

const themes: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const fonts: { value: EditorFont; label: string; sample: string }[] = [
  { value: "sans", label: "Sans", sample: "font-editor-sans" },
  { value: "serif", label: "Serif", sample: "font-editor-serif" },
  { value: "mono", label: "Mono", sample: "font-mono" },
];

/** Quick access to appearance settings: theme, editor font and text size. */
export function ViewMenu() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  const bump = (delta: number) => {
    void update({ editorFontSize: Math.min(32, Math.max(12, settings.editorFontSize + delta)) });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Appearance" title="Appearance">
          <SlidersHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.theme}
          onValueChange={(value) => {
            void update({ theme: value as ThemeMode });
          }}
        >
          {themes.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon /> {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Editor font</DropdownMenuLabel>
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
          Text size{" "}
          <span className="font-mono text-xs text-muted-text">{settings.editorFontSize}px</span>
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            bump(-1);
          }}
        >
          <AArrowDown /> Smaller
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            bump(1);
          }}
        >
          <AArrowUp /> Larger
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
