import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  addColumnRight,
  alignColumn,
  canDeleteRow,
  deleteTableColumn,
  deleteTableRow,
  inTable,
  insertTable,
  nextCell,
  nextRow,
  previousCell,
  tables,
} from "./tables";
import { wikiLinkSyntax } from "./wikilinks";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function editor(doc: string, cursor: number | string) {
  const anchor = typeof cursor === "number" ? cursor : doc.indexOf(cursor);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown({ base: markdownLanguage, extensions: wikiLinkSyntax }), tables()],
    }),
    parent: document.body,
  });
  ensureSyntaxTree(view.state, doc.length, 5000);
  views.push(view);
  return view;
}

/** The document with `‸` marking the cursor. */
function shown(view: EditorView) {
  const doc = view.state.doc.toString();
  const { head } = view.state.selection.main;
  return `${doc.slice(0, head)}‸${doc.slice(head)}`;
}

const TABLE = "| a | b |\n|---|---|\n| 1 | 2 |";

describe("table navigation", () => {
  it("Tab moves to the next cell and formats the table", () => {
    const view = editor("| a | bb |\n|-|-|\n| 1 | 2 |", "a");
    expect(nextCell(view)).toBe(true);
    expect(shown(view)).toBe("| a   | bb‸  |\n| --- | --- |\n| 1   | 2   |");
    // The cell's content is selected, so typing replaces it.
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("bb");
  });

  it("Tab after the last cell adds a row", () => {
    const view = editor(TABLE, "2");
    nextCell(view);
    expect(shown(view)).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ‸    |     |");
  });

  it("Shift-Tab wraps to the previous row", () => {
    const view = editor(TABLE, "1");
    previousCell(view);
    expect(shown(view)).toBe("| a   | b‸   |\n| --- | --- |\n| 1   | 2   |");
  });

  it("Enter goes down, and leaves the table from an empty last row", () => {
    const view = editor(`${TABLE}\n\nafter`, "1");
    nextRow(view);
    expect(shown(view)).toContain("| ‸    |     |");
    nextRow(view);
    expect(shown(view)).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n‸\n\nafter");
  });

  it("leaves a table at the end of the note below a blank line", () => {
    const view = editor(TABLE, "2");
    nextRow(view);
    nextRow(view);
    expect(shown(view)).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n‸");
    expect(inTable(view.state)).toBe(false);
  });

  it("does nothing outside tables, so the keys fall through", () => {
    const view = editor(`text\n\n${TABLE}`, 1);
    expect(inTable(view.state)).toBe(false);
    expect(nextCell(view)).toBe(false);
    expect(nextRow(view)).toBe(false);
  });

  it("ignores tables nested in block quotes", () => {
    const view = editor("> | a |\n> |---|", "a");
    expect(inTable(view.state)).toBe(false);
  });
});

describe("table commands", () => {
  it("adds and deletes rows and columns", () => {
    const view = editor(TABLE, "1");
    addColumnRight(view);
    expect(view.state.doc.toString()).toBe(
      "| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |",
    );
    deleteTableColumn(view);
    expect(view.state.doc.toString()).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |");
    expect(canDeleteRow(view.state)).toBe(true);
    deleteTableRow(view);
    expect(view.state.doc.toString()).toBe("| a   | b   |\n| --- | --- |");
    expect(canDeleteRow(view.state)).toBe(false);
  });

  it("sets column alignment", () => {
    const view = editor(TABLE, "b");
    alignColumn("right")(view);
    expect(view.state.doc.toString()).toBe("| a   | b   |\n| --- | --: |\n| 1   | 2   |");
  });

  it("inserts a table separated from surrounding text", () => {
    const view = editor("before\nafter", 2);
    insertTable(view);
    const doc = view.state.doc.toString();
    expect(doc).toMatch(/^before\n\n\| \S.* \|\n\| -+ \| -+ \| -+ \|\n\|.*\|\n\nafter$/);
    // The first header cell is selected, ready to be renamed.
    const { from, to } = view.state.selection.main;
    expect(doc.slice(from, to)).toMatch(/1$/);
  });
});

describe("table rendering", () => {
  it("draws a table away from the cursor and shows the source under it", () => {
    const doc = "text\n\n| **a** | [[Note]] |\n|---|:-:|\n| `x` | [[Note\\|два]] 2 |";
    const away = editor(doc, 0);
    const table = away.dom.querySelector("table.cm-lp-table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("th strong")?.textContent).toBe("a");
    expect(table?.querySelector("th .cm-lp-wikilink")?.textContent).toBe("Note");
    expect(table?.querySelector("td .cm-lp-code")?.textContent).toBe("x");
    const second = table?.querySelectorAll("td")[1] as HTMLElement | undefined;
    expect(second?.style.textAlign).toBe("center");
    expect(second?.querySelector(".cm-lp-wikilink")?.textContent).toBe("два");

    const inside = editor(doc, doc.indexOf("2"));
    expect(inside.dom.querySelector("table.cm-lp-table")).toBeNull();
  });
});
