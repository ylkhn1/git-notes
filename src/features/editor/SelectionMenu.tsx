import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Code,
  FileSymlink,
  Heading,
  Italic,
  Link as LinkIcon,
  Quote,
  Strikethrough,
} from "lucide-react";

import { type MessageKey, useT } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";

import { commands } from "./cm/commands";
import { insertWikiLink } from "./cm/wikilinks";

interface Action {
  icon: typeof Bold;
  label: MessageKey;
  shortcut?: string;
  run: (view: EditorView) => boolean;
}

const actions: (Action | "sep")[] = [
  { icon: Bold, label: "editor.bold", shortcut: "Mod+B", run: commands.bold },
  { icon: Italic, label: "editor.italic", shortcut: "Mod+I", run: commands.italic },
  { icon: Strikethrough, label: "editor.strikethrough", run: commands.strikethrough },
  { icon: Code, label: "editor.code", shortcut: "Mod+E", run: commands.code },
  "sep",
  { icon: FileSymlink, label: "editor.linkToNote", run: insertWikiLink },
  { icon: LinkIcon, label: "editor.link", shortcut: "Mod+K", run: commands.link },
  "sep",
  { icon: Heading, label: "editor.heading", run: commands.heading },
  { icon: Quote, label: "editor.quote", run: commands.quote },
];

/** Buttons shown above a selection; rendered inside a CodeMirror tooltip. */
export function SelectionMenu({ view }: { view: EditorView }) {
  const t = useT();
  return (
    <div
      role="toolbar"
      aria-label={t("editor.selectionMenu")}
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 text-text shadow-lg"
    >
      {actions.map((action, i) => {
        if (action === "sep") {
          return <span key={`sep-${String(i)}`} className="mx-0.5 h-5 w-px bg-line" />;
        }
        const label = t(action.label);
        const hint = action.shortcut ? `${label} (${formatShortcut(action.shortcut)})` : label;
        return (
          <button
            key={action.label}
            type="button"
            aria-label={label}
            title={hint}
            onMouseDown={(e) => {
              // Keep focus and the selection in the editor.
              e.preventDefault();
            }}
            onClick={() => {
              action.run(view);
              view.focus();
            }}
            className="flex size-7 items-center justify-center rounded-md text-muted-text hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <action.icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
