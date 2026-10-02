import { describe, expect, it } from "vitest";

import { countCharacters, countWords } from "./text";

describe("countWords", () => {
  it("counts prose words and ignores markup", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("# Title\n\nHello, world!")).toBe(3);
    expect(countWords("- [ ] buy milk\n- [x] call mom")).toBe(4);
    expect(countWords("see [the docs](https://example.com/a-b) now")).toBe(4);
    expect(countWords("![alt text](assets/x.png)")).toBe(0);
    expect(countWords("```js\nconst a = 1\n```\ntext")).toBe(1);
    expect(countWords("don't over-think it")).toBe(3);
    expect(countWords("Привет, мир — 2026 год")).toBe(4);
  });

  it("counts non-whitespace characters", () => {
    expect(countCharacters("a b\nc")).toBe(3);
    expect(countCharacters("héllo")).toBe(5);
  });
});
