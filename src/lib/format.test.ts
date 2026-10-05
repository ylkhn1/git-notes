import { describe, expect, it } from "vitest";

import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("picks a unit by size", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(49_152)).toBe("48 KB");
    expect(formatBytes(3.2 * 1024 * 1024)).toBe("3.2 MB");
  });
});
