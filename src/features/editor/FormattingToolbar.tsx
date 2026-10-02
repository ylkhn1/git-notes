import { redo, undo } from "@codemirror/commands";
import {
  Bold,
  Code,
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

import { commands } from "./cm/commands";
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
  const fileInputId = useId();

  const withView =
    (fn: (view: NonNullable<ReturnType<typeof activeEditorView.get>>) => void) => () => {
      const view = activeEditorView.get();
      if (!view) return;
      fn(view);
      view.focus();
    };

  const actions: Action[] = [
    { icon: Heading, label: "Heading", run: withView((v) => commands.heading(v)) },
    { icon: Bold, label: "Bold", run: withView((v) => commands.bold(v)) },
    { icon: Italic, label: "Italic", run: withView((v) => commands.italic(v)) },
    { icon: List, label: "Bullet list", run: withView((v) => commands.bulletList(v)) },
    { icon: ListChecks, label: "Task", run: withView((v) => commands.task(v)) },
    { icon: Quote, label: "Quote", run: withView((v) => commands.quote(v)) },
    { icon: Code, label: "Code", run: withView((v) => commands.code(v)) },
    { icon: LinkIcon, label: "Link", run: withView((v) => commands.link(v)) },
    {
      icon: ImageIcon,
      label: "Attach image",
      run: () => document.getElementById(fileInputId)?.click(),
    },
    { icon: Undo2, label: "Undo", run: withView((v) => undo(v)) },
    { icon: Redo2, label: "Redo", run: withView((v) => redo(v)) },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
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
