import { selectAll } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  ClipboardPaste,
  Code,
  Columns3,
  Copy,
  FileSymlink,
  Italic,
  Link as LinkIcon,
  Scissors,
  SquareDashedMousePointer,
  Strikethrough,
  Table,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { copyText, pasteText } from "@/lib/clipboard";
import { useT } from "@/lib/i18n";
import type { Align } from "@/lib/markdown-table";
import { formatShortcut } from "@/lib/shortcuts";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/ui/context-menu";

import { commands } from "./cm/commands";
import {
  addColumnLeft,
  addColumnRight,
  addRowAbove,
  addRowBelow,
  alignColumn,
  canDeleteColumn,
  canDeleteRow,
  columnAlign,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  formatTableAtCursor,
  insertTable,
} from "./cm/tables";
import { insertWikiLink } from "./cm/wikilinks";

/**
 * Desktop right-click menu for the editor: clipboard actions and formatting. (The webview's
 * own menu is disabled in release builds, see `main.tsx`.)
 */
export function EditorContextMenu({
  view,
  children,
}: {
  view: () => EditorView | null;
  children: ReactNode;
}) {
  // Controlled so the menu re-reads the selection every time it opens.
  const [open, setOpen] = useState(false);
  return (
    <ContextMenu onOpenChange={setOpen}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {open && <MenuContent view={view} />}
    </ContextMenu>
  );
}

function MenuContent({ view: getView }: { view: () => EditorView | null }) {
  const t = useT();
  const view = getView();
  if (!view) return null;
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const hasSelection = !range.empty;
  /** Column alignment when the cursor is in a table, undefined elsewhere. */
  const align = columnAlign(view.state);

  const run = (fn: (v: EditorView) => unknown) => () => {
    fn(view);
    view.focus();
  };
  const copy = () => {
    void copyText(selected).finally(() => view.focus());
  };
  const cut = () => {
    void copyText(selected).then(() => {
      view.dispatch(view.state.replaceSelection(""), {
        userEvent: "delete.cut",
        scrollIntoView: true,
      });
      view.focus();
    });
  };
  const paste = () => {
    void pasteText()
      .then((text) => {
        if (text) {
          view.dispatch(view.state.replaceSelection(text), {
            userEvent: "input.paste",
            scrollIntoView: true,
          });
        }
      })
      .catch((error: unknown) => {
        console.warn("editor: paste failed", error);
      })
      .finally(() => view.focus());
  };

  const item = (
    icon: ReactNode,
    label: string,
    onSelect: () => void,
    shortcut?: string,
    disabled = false,
  ) => (
    <ContextMenuItem onSelect={onSelect} disabled={disabled}>
      {icon} {label}
      {shortcut && <ContextMenuShortcut>{formatShortcut(shortcut)}</ContextMenuShortcut>}
    </ContextMenuItem>
  );

  return (
    <ContextMenuContent className="w-60">
      {item(<Scissors />, t("editor.cut"), cut, "Mod+X", !hasSelection)}
      {item(<Copy />, t("editor.copy"), copy, "Mod+C", !hasSelection)}
      {item(<ClipboardPaste />, t("editor.paste"), paste, "Mod+V")}
      {item(<SquareDashedMousePointer />, t("editor.selectAll"), run(selectAll), "Mod+A")}
      <ContextMenuSeparator />
      {item(<FileSymlink />, t("editor.linkToNote"), run(insertWikiLink))}
      {item(<LinkIcon />, t("editor.link"), run(commands.link), "Mod+K")}
      {align === undefined ? (
        item(<Table />, t("editor.insertTable"), run(insertTable))
      ) : (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Table /> {t("editor.table")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-60">
            {item(<BetweenHorizontalStart />, t("editor.addRowAbove"), run(addRowAbove))}
            {item(<BetweenHorizontalEnd />, t("editor.addRowBelow"), run(addRowBelow))}
            {item(<BetweenVerticalStart />, t("editor.addColumnLeft"), run(addColumnLeft))}
            {item(<BetweenVerticalEnd />, t("editor.addColumnRight"), run(addColumnRight))}
            <ContextMenuSeparator />
            <ContextMenuRadioGroup
              value={align ?? ""}
              onValueChange={(value) => {
                run(alignColumn(value === "" ? null : (value as Align)))();
              }}
            >
              <ContextMenuRadioItem inset value="left">
                {t("editor.alignLeft")}
              </ContextMenuRadioItem>
              <ContextMenuRadioItem inset value="center">
                {t("editor.alignCenter")}
              </ContextMenuRadioItem>
              <ContextMenuRadioItem inset value="right">
                {t("editor.alignRight")}
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
            {item(<Columns3 />, t("editor.formatTable"), run(formatTableAtCursor))}
            <ContextMenuSeparator />
            {item(
              <Trash2 />,
              t("editor.deleteRow"),
              run(deleteTableRow),
              undefined,
              !canDeleteRow(view.state),
            )}
            {item(
              <Trash2 />,
              t("editor.deleteColumn"),
              run(deleteTableColumn),
              undefined,
              !canDeleteColumn(view.state),
            )}
            {item(<Trash2 />, t("editor.deleteTable"), run(deleteTable))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      {item(<Bold />, t("editor.bold"), run(commands.bold), "Mod+B")}
      {item(<Italic />, t("editor.italic"), run(commands.italic), "Mod+I")}
      {item(<Strikethrough />, t("editor.strikethrough"), run(commands.strikethrough))}
      {item(<Code />, t("editor.code"), run(commands.code), "Mod+E")}
    </ContextMenuContent>
  );
}
