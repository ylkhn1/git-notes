import { describe, expect, it } from "vitest";

import { relativeHref } from "./attachments";

describe("relativeHref", () => {
  it("walks up from the note's folder and escapes link-breaking characters", () => {
    expect(relativeHref("note.md", "assets/a.png")).toBe("assets/a.png");
    expect(relativeHref("work/plan.md", "assets/a b.pdf")).toBe("../assets/a%20b.pdf");
    expect(relativeHref("work/q4/plan.md", "work/files/x (1).zip")).toBe(
      "../files/x%20%281%29.zip",
    );
    expect(relativeHref("work/plan.md", "work/image.png")).toBe("image.png");
    expect(relativeHref("a/b.md", "100%.txt")).toBe("../100%25.txt");
  });
});
