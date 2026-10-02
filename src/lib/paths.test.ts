import { describe, expect, it } from "vitest";

import {
  baseName,
  displayTitle,
  ensureMarkdownExt,
  isWithin,
  joinPath,
  parentOf,
  remapPath,
  uniqueName,
} from "./paths";

describe("paths", () => {
  it("splits and joins", () => {
    expect(parentOf("a/b/c.md")).toBe("a/b");
    expect(parentOf("c.md")).toBe("");
    expect(baseName("a/b/c.md")).toBe("c.md");
    expect(joinPath("", "x.md")).toBe("x.md");
    expect(joinPath("a/b", "x.md")).toBe("a/b/x.md");
  });

  it("derives titles and extensions", () => {
    expect(displayTitle("notes/Daily log.md")).toBe("Daily log");
    expect(displayTitle("README.markdown")).toBe("README");
    expect(displayTitle("image.png")).toBe("image.png");
    expect(ensureMarkdownExt("Todo")).toBe("Todo.md");
    expect(ensureMarkdownExt("notes.txt")).toBe("notes.txt");
    expect(ensureMarkdownExt("v1.0 plan")).toBe("v1.0 plan.md");
  });

  it("picks unique names case-insensitively", () => {
    expect(uniqueName([], "Untitled", ".md")).toBe("Untitled.md");
    expect(uniqueName(["untitled.md"], "Untitled", ".md")).toBe("Untitled 2.md");
    expect(uniqueName(["Untitled.md", "Untitled 2.md"], "Untitled", ".md")).toBe("Untitled 3.md");
  });

  it("remaps paths after renames", () => {
    expect(isWithin("a/b/c.md", "a/b")).toBe(true);
    expect(isWithin("a/bc/c.md", "a/b")).toBe(false);
    expect(remapPath("a/b/c.md", "a/b", "x")).toBe("x/c.md");
    expect(remapPath("a/b", "a/b", "x")).toBe("x");
    expect(remapPath("other.md", "a/b", "x")).toBe("other.md");
  });
});
