import { describe, expect, it } from "vitest";

import { notebookAssetUrl, resolveRelativePath } from "./asset-url";

describe("resolveRelativePath", () => {
  it("resolves against the note's directory", () => {
    expect(resolveRelativePath("note.md", "assets/a.png")).toBe("assets/a.png");
    expect(resolveRelativePath("sub/dir/note.md", "../../assets/a.png")).toBe("assets/a.png");
    expect(resolveRelativePath("sub/note.md", "./img%20x.png")).toBe("sub/img x.png");
    expect(resolveRelativePath("note.md", "assets/a.png?raw=1")).toBe("assets/a.png");
  });

  it("rejects escapes and non-relative references", () => {
    expect(resolveRelativePath("note.md", "../outside.png")).toBeNull();
    expect(resolveRelativePath("note.md", "https://x.y/a.png")).toBeNull();
    expect(resolveRelativePath("note.md", "data:image/png;base64,AAAA")).toBeNull();
    expect(resolveRelativePath("note.md", "/etc/passwd")).toBeNull();
  });
});

describe("notebookAssetUrl", () => {
  it("encodes path segments", () => {
    const url = notebookAssetUrl("abc", "assets/my image.png");
    expect(url.endsWith("/abc/assets/my%20image.png")).toBe(true);
    expect(
      url.startsWith("notebook://localhost/") || url.startsWith("http://notebook.localhost/"),
    ).toBe(true);
  });
});
