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
