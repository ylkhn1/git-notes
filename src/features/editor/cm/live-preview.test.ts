import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { activeLines, buildDecorations, livePreview } from "./live-preview";

function stateFor(doc: string, cursor = 0) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage }), livePreview((url) => `resolved:${url}`)],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

/** Collects [from, to, kind] for every decoration; kind is "hide", "widget", "mark" or "line". */
function collect(doc: string, cursor = 0) {
  const state = stateFor(doc, cursor);
  const set = buildDecorations(state, [{ from: 0, to: doc.length }]);
  const out: { from: number; to: number; kind: string; cls?: string }[] = [];
  const iter = set.iter();
  while (iter.value) {
    const spec = iter.value.spec as { widget?: unknown; class?: string };
    const isReplace =
      iter.value.spec !== undefined &&
      Object.getPrototypeOf(iter.value) !== Object.getPrototypeOf(Decoration.mark({}));
    const kind = spec.widget
      ? "widget"
      : iter.from === iter.to
        ? "line"
        : isReplace && !spec.class
          ? "hide"
          : "mark";
    out.push({ from: iter.from, to: iter.to, kind, cls: spec.class });
    iter.next();
  }
  return { state, out, text: (d: { from: number; to: number }) => doc.slice(d.from, d.to) };
}

describe("live preview", () => {
  it("hides heading and emphasis markers on inactive lines only", () => {
    const doc = "# Title\n\nSome **bold** text\n";
    // Cursor on the heading line → heading markers stay, bold markers hidden.
    const { out, text } = collect(doc, 2);
    const hidden = out.filter((d) => d.kind === "hide").map(text);
    expect(hidden).toEqual(["**", "**"]);
    expect(out.some((d) => d.kind === "line" && d.cls?.includes("cm-lp-h1"))).toBe(true);

    // Cursor inside the bold word → the heading marker (and space) is hidden instead.
    const second = collect(doc, doc.indexOf("bold") + 1);
    expect(second.out.filter((d) => d.kind === "hide").map(second.text)).toEqual(["# "]);
  });

  it("turns bullets and tasks into widgets and keeps ordered numbers", () => {
    const doc = "- one\n- [x] done\n1. first\n\ncursor here";
    const { out, text } = collect(doc, doc.length);
    const widgets = out.filter((d) => d.kind === "widget").map(text);
    expect(widgets).toEqual(["-", "-", "[x]"]);
    expect(out.some((d) => d.cls?.includes("cm-lp-task-done"))).toBe(true);
  });

  it("hides link syntax but keeps the text, and replaces images", () => {
    const doc = "see [docs](https://x.y) and ![alt](assets/a.png)\n\n";
    const { out, text } = collect(doc, doc.length);
    const hidden = out.filter((d) => d.kind === "hide").map(text);
    expect(hidden).toEqual(["[", "](https://x.y)"]);
    const link = out.find((d) => d.kind === "mark" && d.cls === "cm-lp-link");
    expect(link && text(link)).toBe("docs");
    const image = out.find((d) => d.kind === "widget");
    expect(image && text(image)).toBe("![alt](assets/a.png)");
  });

  it("styles fenced code blocks and labels the opening fence", () => {
    const doc = "```ts\nlet a = 1\n```\n\nafter";
    const { out, text } = collect(doc, doc.length);
    const lines = out.filter((d) => d.kind === "line").map((d) => d.cls);
    expect(lines).toEqual([
      "cm-lp-codeblock cm-lp-codeblock-start",
      "cm-lp-codeblock",
      "cm-lp-codeblock cm-lp-codeblock-end",
    ]);
    const label = out.find((d) => d.kind === "widget");
    expect(label && text(label)).toBe("```ts");
    expect(out.filter((d) => d.kind === "hide").map(text)).toEqual(["```"]);
  });

  it("hides quote markers and inline code backticks", () => {
    const doc = "> quoted `code` here\n\nx";
    const { out, text } = collect(doc, doc.length);
    expect(out.filter((d) => d.kind === "hide").map(text)).toEqual(["> ", "`", "`"]);
    expect(out.some((d) => d.cls === "cm-lp-quote")).toBe(true);
  });

  it("reports the lines touched by the selection", () => {
    const state = EditorState.create({ doc: "a\nb\nc\nd", selection: { anchor: 2, head: 5 } });
    expect(Array.from(activeLines(state))).toEqual([2, 3]);
  });
});
