import { describe, expect, it } from "vitest";

import { parseRemoteUrl, repoNameFromUrl } from "./remote-url";

describe("parseRemoteUrl", () => {
  it("recognises scp-like and ssh:// urls", () => {
    expect(parseRemoteUrl("git@github.com:me/notes.git")).toEqual({
      transport: "ssh",
      host: "github.com",
    });
    expect(parseRemoteUrl("ssh://git@Gitea.local:2222/me/notes.git")).toEqual({
      transport: "ssh",
      host: "gitea.local",
    });
  });

  it("recognises https and local paths", () => {
    expect(parseRemoteUrl("https://github.com/me/notes.git").transport).toBe("https");
    expect(parseRemoteUrl("https://github.com/me/notes.git").host).toBe("github.com");
    expect(parseRemoteUrl("/srv/git/notes.git").transport).toBe("local");
    expect(parseRemoteUrl("file:///srv/git/notes.git").transport).toBe("local");
    expect(parseRemoteUrl("C:\\git\\notes").transport).toBe("local");
    expect(parseRemoteUrl("").transport).toBe("unknown");
    expect(parseRemoteUrl("nonsense").transport).toBe("unknown");
  });
});

describe("repoNameFromUrl", () => {
  it("strips .git and trailing slashes", () => {
    expect(repoNameFromUrl("git@github.com:me/My-Notes.git")).toBe("My-Notes");
    expect(repoNameFromUrl("https://host/me/notes/")).toBe("notes");
    expect(repoNameFromUrl("")).toBe("");
  });
});
