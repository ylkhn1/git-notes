import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  cycleHeading,
  insertLink,
  toggleBulletList,
  toggleInline,
  toggleQuote,
  toggleTask,
} from "./commands";

function state(doc: string, anchor: number, head = anchor) {
  return EditorState.create({ doc, selection: { anchor, head } });
}

function apply(s: EditorState, spec: TransactionSpec | null) {
  const tr = s.update(spec ?? {});
  return {
    doc: tr.state.doc.toString(),
    sel: [tr.state.selection.main.from, tr.state.selection.main.to],
  };
}

describe("toggleInline", () => {
  it("wraps, unwraps around, and unwraps inside", () => {
    const wrapped = apply(
      state("hello world", 0, 5),
      toggleInline(state("hello world", 0, 5), "**"),
    );
    expect(wrapped.doc).toBe("**hello** world");
    expect(wrapped.sel).toEqual([2, 7]);

    const s2 = state("**hello** world", 2, 7);
    expect(apply(s2, toggleInline(s2, "**")).doc).toBe("hello world");

    const s3 = state("**hello** world", 0, 9);
    const r3 = apply(s3, toggleInline(s3, "**"));
    expect(r3.doc).toBe("hello world");
    expect(r3.sel).toEqual([0, 5]);
  });

  it("inserts an empty pair at a collapsed cursor", () => {
    const s = state("ab", 1);
    const r = apply(s, toggleInline(s, "*"));
    expect(r.doc).toBe("a**b");
    expect(r.sel).toEqual([2, 2]);
  });
});

describe("block prefixes", () => {
  it("toggles bullets across selected lines and respects indentation", () => {
    const s = state("one\n  two\n- three", 0, 15);
    const r = apply(s, toggleBulletList(s));
    expect(r.doc).toBe("- one\n  - two\nthree");
  });

  it("promotes bullets to tasks and back", () => {
    const s = state("- buy milk", 3);
    expect(apply(s, toggleTask(s)).doc).toBe("- [ ] buy milk");
    const done = state("- [x] buy milk", 3);
    expect(apply(done, toggleTask(done)).doc).toBe("- buy milk");
  });

  it("cycles headings and toggles quotes", () => {
    let s = state("Title", 0);
    s = s.update(cycleHeading(s)).state;
    expect(s.doc.toString()).toBe("# Title");
    s = s.update(cycleHeading(s)).state;
    expect(s.doc.toString()).toBe("## Title");
    s = s.update(cycleHeading(s)).state;
    s = s.update(cycleHeading(s)).state;
    expect(s.doc.toString()).toBe("Title");
    const q = state("> quoted", 2);
    expect(apply(q, toggleQuote(q)).doc).toBe("quoted");
  });
});

describe("insertLink", () => {
  it("uses selected text and selects the URL placeholder", () => {
    const s = state("read this", 5, 9);
    const r = apply(s, insertLink(s));
    expect(r.doc).toBe("read [this](https://)");
    expect(r.sel).toEqual([12, 20]);
  });

  it("uses a selected URL as the target and selects the text", () => {
    const s = state("https://a.b", 0, 11);
    const r = apply(s, insertLink(s));
    expect(r.doc).toBe("[link text](https://a.b)");
    expect(r.sel).toEqual([1, 10]);
  });
});
