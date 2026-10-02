import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./time";

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);

  it("describes recent moments in words", () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(formatRelativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(formatRelativeTime(now - 4 * 86_400_000, now)).toBe("4 days ago");
  });

  it("falls back to a date for older entries", () => {
    const text = formatRelativeTime(now - 30 * 86_400_000, now);
    expect(text).not.toContain("ago");
    expect(text.length).toBeGreaterThan(0);
  });
});
