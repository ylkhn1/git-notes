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
  it("draws tables, also the one with the cursor in it", () => {
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
    expect(inside.dom.querySelector("table.cm-lp-table")).not.toBeNull();
    expect(inside.dom.querySelectorAll(".cm-lp-table-add")).toHaveLength(2);
  });
});

describe("editing cells in place", () => {
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  /** Right-clicks a rendered cell (no pointer position, which jsdom cannot map). */
  async function openCell(view: EditorView, selector: string) {
    const cell = view.dom.querySelector(selector);
    cell?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 }));
    await settle();
    const content = view.dom.querySelector(".cm-lp-cell-editing .cm-content");
    const inner = content instanceof HTMLElement ? EditorView.findFromDOM(content) : null;
    if (!inner) throw new Error("no cell editor");
    expect(inner.hasFocus).toBe(true);
    // happy-dom reports selection changes synchronously, in the middle of the update that
    // made them (browsers do it later); without focus the editors leave the DOM selection be.
    inner.contentDOM.blur();
    return inner;
  }

  it("edits the cell's source, escaping pipes, and re-aligns the table on leaving", async () => {
    const view = editor(`${TABLE}\n\nafter`, "after");
    const inner = await openCell(view, "td:nth-child(2)");
    expect(inner.state.doc.toString()).toBe("2");
    inner.dispatch({ changes: { from: 1, insert: "0 | x\ny" }, userEvent: "input.type" });
    expect(inner.state.doc.toString()).toBe("20 \\| x y");
    expect(view.state.doc.toString()).toBe("| a | b |\n|---|---|\n| 1 | 20 \\| x y |\n\nafter");
    expect(view.dom.querySelector("table.cm-lp-table")).not.toBeNull();

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await settle();
    expect(view.dom.querySelector(".cm-lp-cell-editing")).toBeNull();
    expect(view.state.doc.toString()).toBe(
      "| a   | b         |\n| --- | --------- |\n| 1   | 20 \\| x y |\n\nafter",
    );
  });

  it("takes formatting done through the note", async () => {
    const view = editor(`${TABLE}\n\nafter`, "after");
    const inner = await openCell(view, "td:nth-child(1)");
    inner.dispatch({ selection: { anchor: 0, head: 1 } });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "1",
    );
    view.dispatch({
      changes: [
        { from: view.state.selection.main.from, insert: "**" },
        { from: view.state.selection.main.to, insert: "**" },
      ],
    });
    await settle();
    expect(inner.state.doc.toString()).toBe("**1**");
  });

  it("adds a row and a column with the + bars", () => {
    const view = editor(`${TABLE}\n\nafter`, "after");
    const press = (kind: string) => {
      view.dom
        .querySelector(`[data-table-add="${kind}"]`)
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    };
    press("row");
    expect(view.state.doc.toString()).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n\nafter",
    );
    press("column");
    expect(view.state.doc.toString()).toBe(
      "| a   | b   |     |\n| --- | --- | --- |\n| 1   | 2   |     |\n|     |     |     |\n\nafter",
    );
  });
});
