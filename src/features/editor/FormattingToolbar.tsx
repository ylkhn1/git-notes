import { redo, undo } from "@codemirror/commands";
import {
  Bold,
  Code,
  FileSymlink,
  Heading,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react";
import { useId } from "react";

import { useT } from "@/lib/i18n";

import { commands } from "./cm/commands";
import { insertWikiLink } from "./cm/wikilinks";
import { pasteImages } from "./images";
import { useEditorStore } from "./store";
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
  const fileInputId = useId();

  const withView =
    (fn: (view: NonNullable<ReturnType<typeof activeEditorView.get>>) => void) => () => {
      const view = activeEditorView.get();
      if (!view) return;
      fn(view);
      view.focus();
    };

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
    {
      icon: ImageIcon,
      label: t("editor.attachImage"),
      run: () => document.getElementById(fileInputId)?.click(),
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
      {actions.map(({ icon: Icon, label, run }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          onPointerDown={(e) => {
            e.preventDefault();
          }}
          onClick={run}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-text active:bg-surface-2"
        >
          <Icon className="size-5" aria-hidden="true" />
        </button>
      ))}
      <input
        id={fileInputId}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          const view = activeEditorView.get();
          const { notebookId, activePath } = useEditorStore.getState();
          if (files.length && view && notebookId && activePath) {
            void pasteImages(notebookId, activePath, files, view);
          }
        }}
      />
    </div>
  );
}
