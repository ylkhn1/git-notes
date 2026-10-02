import { describe, expect, it } from "vitest";

import { collectFolders, validateName } from "./validation";

describe("validateName", () => {
  it("accepts ordinary names and rejects unsafe ones", () => {
    expect(validateName("Daily log.md")).toBeNull();
    expect(validateName("a/b")).not.toBeNull();
    expect(validateName("..")).not.toBeNull();
    expect(validateName(".hidden")).not.toBeNull();
  });
});

describe("collectFolders", () => {
  it("lists folders depth-first", () => {
    const folders = collectFolders([
      {
        name: "a",
        path: "a",
        kind: "dir",
        children: [{ name: "b", path: "a/b", kind: "dir", children: [] }],
      },
      { name: "n.md", path: "n.md", kind: "file", children: [] },
      { name: "c", path: "c", kind: "dir", children: [] },
    ]);
    expect(folders).toEqual(["a", "a/b", "c"]);
  });
});
