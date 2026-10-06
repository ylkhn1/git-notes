import { describe, expect, it } from "vitest";

import { formatShortcut, matchesShortcut, parseShortcut } from "./shortcuts";

const key = (overrides: Partial<Parameters<typeof matchesShortcut>[0]> & { key: string }) => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe("parseShortcut", () => {
  it("reads modifiers and the key", () => {
    expect(parseShortcut("Mod+Shift+S")).toEqual({ mod: true, shift: true, alt: false, key: "s" });
    expect(parseShortcut("F2")).toEqual({ mod: false, shift: false, alt: false, key: "f2" });
    expect(parseShortcut("Mod+,")).toEqual({ mod: true, shift: false, alt: false, key: "," });
  });
});

describe("matchesShortcut", () => {
  it("uses Ctrl on Linux/Windows and Meta on macOS", () => {
    expect(matchesShortcut(key({ key: "k", ctrlKey: true }), "Mod+K", false)).toBe(true);
    expect(matchesShortcut(key({ key: "k", metaKey: true }), "Mod+K", false)).toBe(false);
    expect(matchesShortcut(key({ key: "k", metaKey: true }), "Mod+K", true)).toBe(true);
  });

  it("requires exact modifiers", () => {
    expect(
      matchesShortcut(key({ key: "S", ctrlKey: true, shiftKey: true }), "Mod+Shift+S", false),
    ).toBe(true);
    expect(matchesShortcut(key({ key: "s", ctrlKey: true }), "Mod+Shift+S", false)).toBe(false);
    expect(matchesShortcut(key({ key: "s", ctrlKey: true, altKey: true }), "Mod+S", false)).toBe(
      false,
    );
  });

  it("accepts + for Mod+=", () => {
    expect(
      matchesShortcut(key({ key: "+", ctrlKey: true, shiftKey: true }), "Mod+Shift+=", false),
    ).toBe(true);
  });

  it("matches by physical key on non-Latin layouts", () => {
    const ru = (k: string, code: string, shiftKey = false) =>
      key({ key: k, code, ctrlKey: true, shiftKey });
    expect(matchesShortcut(ru("л", "KeyK"), "Mod+K", false)).toBe(true);
    expect(matchesShortcut(ru("А", "KeyF", true), "Mod+Shift+F", false)).toBe(true);
    expect(matchesShortcut(ru("б", "Comma"), "Mod+,", false)).toBe(true);
    // The Russian layout has "." on the US slash key.
    expect(matchesShortcut(ru(".", "Slash"), "Mod+/", false)).toBe(true);
    expect(matchesShortcut(ru("л", "KeyK"), "Mod+P", false)).toBe(false);
    // A Latin layout's own letters win: Dvorak's K sits on the US V key.
    expect(matchesShortcut(ru("k", "KeyV"), "Mod+V", false)).toBe(false);
  });
});

describe("formatShortcut", () => {
  it("renders platform labels", () => {
    expect(formatShortcut("Mod+Shift+S", false)).toBe("Ctrl+Shift+S");
    expect(formatShortcut("Mod+Shift+S", true)).toBe("⇧⌘S");
    expect(formatShortcut("Mod+,", false)).toBe("Ctrl+,");
    expect(formatShortcut("Mod+-", false)).toBe("Ctrl+−");
    expect(formatShortcut("F2", false)).toBe("F2");
  });
});
