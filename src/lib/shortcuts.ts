import { latinKeyForCode } from "./keyboard-layout";
import { isMac } from "./platform";

/**
 * Keyboard shortcuts are written as `Mod+Shift+K`: `Mod` is Ctrl on Linux/Windows and ⌘ on
 * macOS. Keys are compared case-insensitively against `event.key`; when that is not a Latin
 * letter or digit (a Russian layout gives `р` for H), the physical key (`event.code`) decides.
 */
export interface Shortcut {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseShortcut(text: string): Shortcut {
  const parts = text.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    mod: mods.has("mod") || mods.has("ctrl") || mods.has("cmd"),
    shift: mods.has("shift"),
    alt: mods.has("alt"),
    key: key.toLowerCase(),
  };
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** True when the key event is exactly this shortcut (no extra modifiers). */
export function matchesShortcut(event: KeyLike, text: string, mac: boolean = isMac): boolean {
  const s = parseShortcut(text);
  const mod = mac ? event.metaKey : event.ctrlKey;
  const otherMod = mac ? event.ctrlKey : event.metaKey;
  if (otherMod) return false;
  if (mod !== s.mod || event.shiftKey !== s.shift || event.altKey !== s.alt) return false;
  const key = event.key.toLowerCase();
  if (sameKey(key, s.key)) return true;
  // Letters and digits of the current layout are what the user means; anything else may be
  // another layout's letter in the place of the Latin key.
  if (/^[a-z0-9]$/.test(key) || !event.code) return false;
  const physical = latinKeyForCode(event.code);
  return physical !== null && sameKey(physical, s.key);
}

/** Shift+= arrives as "+" on most layouts; accept the un-shifted key too. */
function sameKey(key: string, wanted: string): boolean {
  return key === wanted || (wanted === "=" && key === "+");
}

/** Display form: "Ctrl+Shift+S" or "⇧⌘S". */
export function formatShortcut(text: string, mac: boolean = isMac): string {
  const s = parseShortcut(text);
  const keyLabel = labelForKey(s.key, mac);
  if (mac) {
    return `${s.alt ? "⌥" : ""}${s.shift ? "⇧" : ""}${s.mod ? "⌘" : ""}${keyLabel}`;
  }
  const parts: string[] = [];
  if (s.mod) parts.push("Ctrl");
  if (s.alt) parts.push("Alt");
  if (s.shift) parts.push("Shift");
  parts.push(keyLabel);
  return parts.join("+");
}

function labelForKey(key: string, mac: boolean): string {
  switch (key) {
    case ",":
      return ",";
    case "/":
      return "/";
    case "=":
      return mac ? "=" : "+";
    case "-":
      return "−";
    case "escape":
      return "Esc";
    case "enter":
      return "Enter";
    default:
      return key.length === 1
        ? key.toUpperCase()
        : `${(key[0] ?? "").toUpperCase()}${key.slice(1)}`;
  }
}
