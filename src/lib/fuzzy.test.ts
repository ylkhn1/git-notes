import { describe, expect, it } from "vitest";

import { fuzzyMatch, highlightRuns, rankItems } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches everything for an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("prefers substrings over scattered subsequences", () => {
    const sub = fuzzyMatch("sync", "Sync now");
    const scattered = fuzzyMatch("sync", "Settings · your notebook config");
    expect(sub?.score ?? -1).toBeGreaterThan(scattered?.score ?? -1);
    expect(sub?.positions).toEqual([0, 1, 2, 3]);
  });

  it("matches initials at word starts", () => {
    expect(fuzzyMatch("nn", "New note")?.positions).toEqual([0, 4]);
  });

  it("falls back when preferring word starts would skip the only path", () => {
    const m = fuzzyMatch("theme dark", "Theme: Dark appearance night");
    expect(m?.positions).toEqual([0, 1, 2, 3, 4, 7, 8, 9, 10]);
  });

  it("is case-insensitive and rejects missing characters", () => {
    expect(fuzzyMatch("ROADMAP", "Projects/Roadmap.md")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Roadmap")).toBeNull();
  });
});

describe("rankItems", () => {
  const items = ["Sync now", "Sync settings…", "New note", "Close notebook", "Credentials…"];

  it("keeps input order without a query", () => {
    expect(rankItems(items, "", (s) => s).map((r) => r.item)).toEqual(items);
  });

  it("filters and sorts by score", () => {
    const ranked = rankItems(items, "syn", (s) => s).map((r) => r.item);
    expect(ranked[0]).toBe("Sync now");
    expect(ranked).toContain("Sync settings…");
    expect(ranked).not.toContain("Credentials…");
  });

  it("honours the limit", () => {
    expect(rankItems(items, "", (s) => s, 2)).toHaveLength(2);
  });
});

describe("highlightRuns", () => {
  it("groups adjacent matched characters", () => {
    expect(highlightRuns("Sync now", [0, 1, 2, 3])).toEqual([
      { text: "Sync", hit: true },
      { text: " now", hit: false },
    ]);
    expect(highlightRuns("New note", [0, 4])).toEqual([
      { text: "N", hit: true },
      { text: "ew ", hit: false },
      { text: "n", hit: true },
      { text: "ote", hit: false },
    ]);
  });
});
