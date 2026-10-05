import { describe, expect, it } from "vitest";

import type { NoteLinks } from "@/lib/bindings";

import {
  backlinksTo,
  findHeadingLine,
  linkTargetFor,
  normalizeTarget,
  parseWikiInner,
  planLinkRewrites,
  resolveWikiTarget,
} from "./wikilinks";

const notes = [
  "Welcome.md",
  "Ideas.md",
  "Projects/Roadmap.md",
  "Projects/Ideas.md",
  "Archive/2025/Roadmap.md",
  "Заметки/Идеи.md",
];

const link = (target: string, lineNo = 1) => ({
  target,
  heading: null,
  alias: null,
  lineNo,
  line: `[[${target}]]`,
});

describe("parseWikiInner", () => {
  it("splits target, heading and alias", () => {
    expect(parseWikiInner("Projects/Roadmap#Q4|the plan")).toEqual({
      target: "Projects/Roadmap",
      heading: "Q4",
      alias: "the plan",
    });
    expect(parseWikiInner(" Ideas ")).toEqual({ target: "Ideas", heading: null, alias: null });
    expect(parseWikiInner("#Top")).toEqual({ target: "", heading: "Top", alias: null });
  });

  it("accepts the table-escaped pipe", () => {
    expect(parseWikiInner("Roadmap#Q4\\|plan")).toEqual({
      target: "Roadmap",
      heading: "Q4",
      alias: "plan",
    });
  });
});

describe("normalizeTarget", () => {
  it("matches the Rust implementation", () => {
    expect(normalizeTarget(" ./Folder/Note.md ")).toBe("folder/note");
    expect(normalizeTarget("/Идеи.MD")).toBe("идеи");
    expect(normalizeTarget("a\\b")).toBe("a/b");
  });
});

describe("resolveWikiTarget", () => {
  it("resolves names, paths and suffixes case-insensitively", () => {
    expect(resolveWikiTarget("welcome", notes, null)).toBe("Welcome.md");
    expect(resolveWikiTarget("Projects/Roadmap", notes, null)).toBe("Projects/Roadmap.md");
    expect(resolveWikiTarget("2025/roadmap.md", notes, null)).toBe("Archive/2025/Roadmap.md");
    expect(resolveWikiTarget("идеи", notes, null)).toBe("Заметки/Идеи.md");
    expect(resolveWikiTarget("Missing", notes, null)).toBeNull();
    expect(resolveWikiTarget("", notes, null)).toBeNull();
  });

  it("prefers the linking note's folder, then the shallowest path", () => {
    expect(resolveWikiTarget("Ideas", notes, "Welcome.md")).toBe("Ideas.md");
    expect(resolveWikiTarget("Ideas", notes, "Projects/Roadmap.md")).toBe("Projects/Ideas.md");
    expect(resolveWikiTarget("Roadmap", notes, "Welcome.md")).toBe("Projects/Roadmap.md");
    expect(resolveWikiTarget("Roadmap", notes, "Archive/2025/Notes.md")).toBe(
      "Archive/2025/Roadmap.md",
    );
  });
});

describe("linkTargetFor", () => {
  it("uses the name when it is unambiguous from the source", () => {
    expect(linkTargetFor("Welcome.md", notes, null)).toBe("Welcome");
    expect(linkTargetFor("Projects/Ideas.md", notes, "Projects/Roadmap.md")).toBe("Ideas");
    expect(linkTargetFor("Projects/Ideas.md", notes, "Welcome.md")).toBe("Projects/Ideas");
  });
});

describe("backlinksTo", () => {
  it("collects links from other notes that resolve to the note", () => {
    const index: NoteLinks[] = [
      { path: "Welcome.md", links: [link("Ideas", 3), link("Roadmap", 4)] },
      { path: "Projects/Roadmap.md", links: [link("Ideas", 1)] },
      { path: "Ideas.md", links: [link("Ideas", 9)] },
    ];
    expect(backlinksTo("Ideas.md", index, notes)).toEqual([
      { path: "Welcome.md", lineNo: 3, line: "[[Ideas]]" },
    ]);
    expect(backlinksTo("Projects/Ideas.md", index, notes).map((b) => b.path)).toEqual([
      "Projects/Roadmap.md",
    ]);
  });
});

describe("planLinkRewrites", () => {
  it("renames link text when a note is renamed", () => {
    const index: NoteLinks[] = [
      { path: "Welcome.md", links: [link("Ideas"), link("ideas"), link("Missing")] },
    ];
    const before = ["Welcome.md", "Ideas.md"];
    const after = ["Welcome.md", "Thoughts.md"];
    const moved = (p: string) => (p === "Ideas.md" ? "Thoughts.md" : p);
    expect(planLinkRewrites(index, before, after, moved)).toEqual([
      { path: "Welcome.md", replacements: [{ from: "ideas", to: "Thoughts" }] },
    ]);
  });

  it("keeps name links that still resolve after a move and qualifies ambiguous ones", () => {
    const index: NoteLinks[] = [
      { path: "Welcome.md", links: [link("Plan")] },
      { path: "Work/Todo.md", links: [link("Work/Plan")] },
    ];
    const before = ["Welcome.md", "Work/Plan.md", "Work/Todo.md", "Home/Other.md"];
    // Unique name: moving to Home/ needs no change for [[Plan]], but [[Work/Plan]] breaks.
    const after = ["Welcome.md", "Home/Plan.md", "Work/Todo.md", "Home/Other.md"];
    const moved = (p: string) => (p === "Work/Plan.md" ? "Home/Plan.md" : p);
    expect(planLinkRewrites(index, before, after, moved)).toEqual([
      { path: "Work/Todo.md", replacements: [{ from: "work/plan", to: "Plan" }] },
    ]);
  });

  it("follows the linking note when it moves itself", () => {
    const index: NoteLinks[] = [{ path: "A/Note.md", links: [link("Ideas")] }];
    const before = ["A/Note.md", "A/Ideas.md", "B/Ideas.md"];
    const after = ["B/Note.md", "A/Ideas.md", "B/Ideas.md"];
    const moved = (p: string) => (p === "A/Note.md" ? "B/Note.md" : p);
    expect(planLinkRewrites(index, before, after, moved)).toEqual([
      { path: "B/Note.md", replacements: [{ from: "ideas", to: "A/Ideas" }] },
    ]);
  });
});

describe("findHeadingLine", () => {
  it("finds ATX headings by text", () => {
    const text = "# Title\n\nbody\n## Q4 plan ##\n### Other";
    expect(findHeadingLine(text, "q4 plan")).toBe(4);
    expect(findHeadingLine(text, "Title")).toBe(1);
    expect(findHeadingLine(text, "nope")).toBeNull();
  });
});
