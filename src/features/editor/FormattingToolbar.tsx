import { redo, undo } from "@codemirror/commands";
import type { Command } from "@codemirror/view";
import {
  ArrowRightToLine,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Code,
  Columns3,
  FileSymlink,
  Heading,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  Paperclip,
  List,
  ListChecks,
  Quote,
  Redo2,
  Table,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState } from "react";

import { useT } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

import { commands } from "./cm/commands";
import {
  addColumnLeft,
  addColumnRight,
  addRowAbove,
  addRowBelow,
  alignColumn,
  canDeleteColumn,
  canDeleteRow,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  formatTableAtCursor,
  insertTable,
  nextCell,
} from "./cm/tables";
import { insertWikiLink } from "./cm/wikilinks";
import { attachPickedFiles } from "./attachments";
import { useTableCursor } from "./table-cursor";
import { activeEditorView } from "./view-ref";

interface Action {
  icon: typeof Bold;
  label: string;
  run: () => void;
}

/**
 * Mobile formatting toolbar, pinned above the keyboard. Buttons keep focus inside the editor
 * (pointerdown is prevented) so the keyboard never flickers.
 */
export function FormattingToolbar() {
  const t = useT();

  const withView =
    (fn: (view: NonNullable<ReturnType<typeof activeEditorView.get>>) => void) => () => {
      const view = activeEditorView.get();
      if (!view) return;
      fn(view);
      view.focus();
    };

  const inTable = useTableCursor((s) => s.inTable);
  const tableActions: Action[] = inTable
    ? [
        { icon: ArrowRightToLine, label: t("editor.nextCell"), run: withView((v) => nextCell(v)) },
        {
          icon: BetweenHorizontalEnd,
          label: t("editor.addRowBelow"),
          run: withView((v) => addRowBelow(v)),
        },
      ]
    : [];
  const actions: Action[] = [
    { icon: Heading, label: t("editor.heading"), run: withView((v) => commands.heading(v)) },
    { icon: Bold, label: t("editor.bold"), run: withView((v) => commands.bold(v)) },
    { icon: Italic, label: t("editor.italic"), run: withView((v) => commands.italic(v)) },
    { icon: List, label: t("editor.bulletList"), run: withView((v) => commands.bulletList(v)) },
    { icon: ListChecks, label: t("editor.task"), run: withView((v) => commands.task(v)) },
    { icon: Quote, label: t("editor.quote"), run: withView((v) => commands.quote(v)) },
    { icon: Code, label: t("editor.code"), run: withView((v) => commands.code(v)) },
    { icon: FileSymlink, label: t("editor.linkToNote"), run: withView((v) => insertWikiLink(v)) },
    { icon: LinkIcon, label: t("editor.link"), run: withView((v) => commands.link(v)) },
    ...(inTable
      ? []
      : [{ icon: Table, label: t("editor.insertTable"), run: withView((v) => insertTable(v)) }]),
    {
      icon: ImageIcon,
      label: t("editor.attachImage"),
      run: () => void attachPickedFiles("image/*"),
    },
    {
      icon: Paperclip,
      label: t("editor.attachFile"),
      run: () => void attachPickedFiles(),
    },
    { icon: Undo2, label: t("editor.undo"), run: withView((v) => undo(v)) },
    { icon: Redo2, label: t("editor.redo"), run: withView((v) => redo(v)) },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t("editor.formatting")}
      className="flex h-12 shrink-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto border-t border-line bg-surface px-1"
    >
      {tableActions.map((action) => (
        <ToolbarButton key={action.label} action={action} />
      ))}
      {inTable && <TableMenu />}
      {inTable && <span className="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true" />}
      {actions.map((action) => (
        <ToolbarButton key={action.label} action={action} />
      ))}
    </div>
  );
}

const BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-md text-text active:bg-surface-2";

function ToolbarButton({ action: { icon: Icon, label, run } }: { action: Action }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
      }}
      onClick={run}
      className={BUTTON}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}

/** The rest of the table actions, behind one button (shown while the cursor is in a table). */
function TableMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const view = activeEditorView.get();
  const run = (command: Command) => () => {
    const current = activeEditorView.get();
    if (current) command(current);
  };
  const item = (Icon: typeof Table, label: string, command: Command, disabled = false) => (
    <DropdownMenuItem onSelect={run(command)} disabled={disabled}>
      <Icon /> {label}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("editor.table")}
          title={t("editor.table")}
          // Keep the editor focused until the menu really opens (see the toolbar note).
          onPointerDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => {
            setOpen(true);
          }}
          className={BUTTON}
        >
          <Table className="size-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-60"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          activeEditorView.get()?.focus();
        }}
      >
        {item(BetweenHorizontalStart, t("editor.addRowAbove"), addRowAbove)}
        {item(BetweenHorizontalEnd, t("editor.addRowBelow"), addRowBelow)}
        {item(BetweenVerticalStart, t("editor.addColumnLeft"), addColumnLeft)}
        {item(BetweenVerticalEnd, t("editor.addColumnRight"), addColumnRight)}
        <DropdownMenuSeparator />
        {item(TextAlignStart, t("editor.alignLeft"), alignColumn("left"))}
        {item(TextAlignCenter, t("editor.alignCenter"), alignColumn("center"))}
        {item(TextAlignEnd, t("editor.alignRight"), alignColumn("right"))}
        {item(Columns3, t("editor.formatTable"), formatTableAtCursor)}
        <DropdownMenuSeparator />
        {item(Trash2, t("editor.deleteRow"), deleteTableRow, !view || !canDeleteRow(view.state))}
        {item(
          Trash2,
          t("editor.deleteColumn"),
          deleteTableColumn,
          !view || !canDeleteColumn(view.state),
        )}
        {item(Trash2, t("editor.deleteTable"), deleteTable)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
