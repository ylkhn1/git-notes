import { describe, expect, it } from "vitest";

import type { NoteLinks } from "@/lib/bindings";

import { allTags, buildTagTree, isValidTag, tagMatches } from "./tags";

const note = (path: string, tags: string[]): NoteLinks => ({ path, links: [], tags });

describe("tags", () => {
  it("validates tag bodies like Rust does", () => {
    expect(isValidTag("work")).toBe(true);
    expect(isValidTag("проект/план")).toBe(true);
    expect(isValidTag("2026-q4")).toBe(true);
    expect(isValidTag("123")).toBe(false);
    expect(isValidTag("/x")).toBe(false);
    expect(isValidTag("a b")).toBe(false);
    expect(isValidTag("")).toBe(false);
  });

  it("matches nested tags", () => {
    expect(tagMatches("Work/Plans", "work")).toBe(true);
    expect(tagMatches("work", "#WORK")).toBe(true);
    expect(tagMatches("workshop", "work")).toBe(false);
    expect(tagMatches("work", "work/plans")).toBe(false);
  });

  it("builds a counted tree, counting each note once per node", () => {
    const tree = buildTagTree([
      note("a.md", ["work/plans", "work/ideas", "home"]),
      note("b.md", ["Work"]),
      note("c.md", ["work/plans"]),
    ]);
    expect(tree.map((n) => [n.name, n.count])).toEqual([
      ["home", 1],
      ["work", 3],
    ]);
    const work = tree[1];
    expect(work?.children.map((n) => [n.tag, n.count])).toEqual([
      ["work/ideas", 1],
      ["work/plans", 2],
    ]);
  });

  it("lists tags by use", () => {
    expect(allTags([note("a", ["x", "Y"]), note("b", ["y"]), note("c", ["z", "y"])])).toEqual([
      "Y",
      "x",
      "z",
    ]);
  });
});
