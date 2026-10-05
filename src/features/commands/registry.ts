import {
  AArrowDown,
  AArrowUp,
  AlertTriangle,
  CloudDownload,
  Download,
  FilePlus,
  FileSearch,
  FolderOpen,
  FolderPlus,
  History,
  Info,
  Keyboard,
  KeyRound,
  type LucideIcon,
  Monitor,
  Moon,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Settings,
  Settings2,
  SlidersHorizontal,
  Sun,
  Terminal,
  Trash2,
  Type,
  X,
} from "lucide-react";

import { parentOf } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { matchesShortcut } from "@/lib/shortcuts";

import { useEditorStore } from "@/features/editor/store";
import { useConflictsDialog } from "@/features/conflicts/dialog-store";
import { useNotebooksStore } from "@/features/notebooks/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUiStore } from "@/features/shell/ui-store";
import { useSyncStore } from "@/features/sync/store";
import { useTreeDialogStore } from "@/features/tree/dialog-store";
import { findNode, useTreeStore } from "@/features/tree/store";
import { useUpdateStore } from "@/features/updates/store";

export type CommandGroup = "Go" | "Note" | "Notebook" | "Sync" | "View" | "Help";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** `Mod+Shift+S` form; see `lib/shortcuts.ts`. Desktop only. */
  shortcut?: string;
  icon?: LucideIcon;
  /** Extra words the palette should match. */
  keywords?: string;
  /** Absent → always available. */
  when?: () => boolean;
  run: () => void | Promise<void>;
}

const GROUP_ORDER: CommandGroup[] = ["Go", "Note", "Notebook", "Sync", "View", "Help"];

export function groupOrder(group: CommandGroup): number {
  return GROUP_ORDER.indexOf(group);
}

function selectedDir(): string {
  const tree = useTreeStore.getState();
  const node = tree.selectedPath ? findNode(tree.nodes, tree.selectedPath) : undefined;
  return node ? (node.kind === "dir" ? node.path : parentOf(node.path)) : "";
}

const hasNotebook = () => useNotebooksStore.getState().current !== null;
const hasActiveNote = () => useEditorStore.getState().activePath !== null;
const canSync = () => {
  const { status, state } = useSyncStore.getState();
  return Boolean(status?.isRepo && status.remoteUrl) && state.state !== "syncing";
};

/**
 * Every user-facing action in one place: the palette lists them, the shortcut handler
 * dispatches them, and the shortcuts help renders them. Built on demand so dynamic entries
 * (switch to notebook X) stay current.
 */
export function listCommands(): Command[] {
  const ui = useUiStore.getState();
  const settings = useSettingsStore.getState();
  const notebooks = useNotebooksStore.getState();
  const bump = (delta: number) => {
    const size = settings.settings.editorFontSize;
    void settings.update({ editorFontSize: Math.min(32, Math.max(12, size + delta)) });
  };

  const commands: Command[] = [
    {
      id: "go.palette",
      title: "Command palette",
      group: "Go",
      shortcut: "Mod+K",
      icon: Terminal,
      keywords: "actions",
      run: () => ui.openPalette("commands"),
    },
    {
      id: "go.note",
      title: "Go to note…",
      group: "Go",
      shortcut: "Mod+P",
      icon: FileSearch,
      keywords: "open quick switcher file",
      when: hasNotebook,
      run: () => ui.openPalette("files"),
    },
    {
      id: "go.search",
      title: "Search in notes…",
      group: "Go",
      shortcut: "Mod+Shift+F",
      icon: Search,
      keywords: "find text grep",
      when: hasNotebook,
      run: () => ui.openPalette("search"),
    },

    {
      id: "note.new",
      title: "New note",
      group: "Note",
      shortcut: "Mod+N",
      icon: FilePlus,
      keywords: "create",
      when: hasNotebook,
      run: () => {
        if (isMobile) {
          useTreeDialogStore.getState().open({ kind: "new-note", dir: selectedDir() });
          return;
        }
        const current = useNotebooksStore.getState().current;
        if (!current) return;
        void useTreeStore
          .getState()
          .createNote(selectedDir())
          .then((path) => useEditorStore.getState().open(current.id, path));
      },
    },
    {
      id: "note.save",
      title: "Save",
      group: "Note",
      shortcut: "Mod+S",
      icon: Save,
      when: hasActiveNote,
      run: () => useEditorStore.getState().saveAll(),
    },
    {
      id: "note.close",
      title: "Close tab",
      group: "Note",
      shortcut: "Mod+W",
      icon: X,
      when: () => !isMobile && hasActiveNote(),
      run: () => {
        const active = useEditorStore.getState().activePath;
        if (active) void useEditorStore.getState().close(active);
      },
    },
    {
      id: "note.rename",
      title: "Rename note…",
      group: "Note",
      shortcut: "F2",
      icon: Pencil,
      when: hasActiveNote,
      run: () => {
        const active = useEditorStore.getState().activePath;
        if (active) useTreeDialogStore.getState().open({ kind: "rename", path: active });
      },
    },
    {
      id: "note.delete",
      title: "Delete note…",
      group: "Note",
      icon: Trash2,
      keywords: "remove",
      when: hasActiveNote,
      run: () => {
        const active = useEditorStore.getState().activePath;
        if (active) useTreeDialogStore.getState().open({ kind: "delete", path: active });
      },
    },
    {
      id: "note.history",
      title: "Note history…",
      group: "Note",
      icon: History,
      keywords: "versions diff commits",
      when: () => hasActiveNote() && Boolean(useSyncStore.getState().status?.isRepo),
      run: () => ui.openDialog("history"),
    },

    {
      id: "notebook.new",
      title: "New notebook…",
      group: "Notebook",
      icon: FolderPlus,
      run: () => ui.openDialog("newNotebook"),
    },
    {
      id: "notebook.clone",
      title: "Clone repository…",
      group: "Notebook",
      icon: CloudDownload,
      keywords: "git download",
      run: () => ui.openDialog("clone"),
    },
    {
      id: "notebook.open",
      title: "Open folder…",
      group: "Notebook",
      icon: FolderOpen,
      when: () => !isMobile,
      run: () => notebooks.openFolder().then(() => undefined),
    },
    ...notebooks.notebooks
      .filter((nb) => nb.id !== notebooks.current?.id)
      .map((nb): Command => ({
        id: `notebook.switch.${nb.id}`,
        title: `Switch to notebook: ${nb.name}`,
        group: "Notebook",
        icon: FolderOpen,
        keywords: nb.path,
        run: () => notebooks.select(nb.id),
      })),
    {
      id: "notebook.close",
      title: "Close notebook",
      group: "Notebook",
      icon: X,
      when: hasNotebook,
      run: () => notebooks.closeCurrent(),
    },

    {
      id: "sync.now",
      title: "Sync now",
      group: "Sync",
      shortcut: "Mod+Shift+S",
      icon: RefreshCw,
      keywords: "push pull git",
      when: canSync,
      run: () =>
        useSyncStore
          .getState()
          .syncNow()
          .then(() => undefined),
    },
    {
      id: "sync.conflicts",
      title: "Review conflict copies…",
      group: "Sync",
      icon: AlertTriangle,
      when: () => useSyncStore.getState().conflicts.length > 0,
      run: () => useConflictsDialog.getState().show(),
    },
    {
      id: "sync.history",
      title: "Notebook history…",
      group: "Sync",
      icon: History,
      keywords: "commits log",
      when: () => hasNotebook() && Boolean(useSyncStore.getState().status?.isRepo),
      run: () => ui.openDialog("history"),
    },
    {
      id: "sync.remote",
      title: "Remote & git setup…",
      group: "Sync",
      icon: Settings2,
      keywords: "url origin init",
      when: hasNotebook,
      run: () => ui.openDialog("remote"),
    },
    {
      id: "sync.credentials",
      title: "Credentials…",
      group: "Sync",
      icon: KeyRound,
      keywords: "ssh key token",
      run: () => ui.openDialog("credentials"),
    },

    {
      id: "view.theme.system",
      title: "Theme: System",
      group: "View",
      icon: Monitor,
      keywords: "appearance auto",
      run: () => settings.update({ theme: "system" }),
    },
    {
      id: "view.theme.light",
      title: "Theme: Light",
      group: "View",
      icon: Sun,
      keywords: "appearance",
      run: () => settings.update({ theme: "light" }),
    },
    {
      id: "view.theme.dark",
      title: "Theme: Dark",
      group: "View",
      icon: Moon,
      keywords: "appearance night",
      run: () => settings.update({ theme: "dark" }),
    },
    {
      id: "view.font.sans",
      title: "Editor font: Sans",
      group: "View",
      icon: Type,
      run: () => settings.update({ editorFont: "sans" }),
    },
    {
      id: "view.font.serif",
      title: "Editor font: Serif",
      group: "View",
      icon: Type,
      run: () => settings.update({ editorFont: "serif" }),
    },
    {
      id: "view.font.mono",
      title: "Editor font: Mono",
      group: "View",
      icon: Type,
      keywords: "monospace code",
      run: () => settings.update({ editorFont: "mono" }),
    },
    {
      id: "view.text.larger",
      title: "Larger text",
      group: "View",
      shortcut: "Mod+Shift+=",
      icon: AArrowUp,
      keywords: "zoom in font size",
      run: () => bump(1),
    },
    {
      id: "view.text.smaller",
      title: "Smaller text",
      group: "View",
      shortcut: "Mod+-",
      icon: AArrowDown,
      keywords: "zoom out font size",
      run: () => bump(-1),
    },

    {
      id: "help.settings",
      title: "Settings…",
      group: "Help",
      shortcut: "Mod+,",
      icon: Settings,
      keywords: "preferences options",
      run: () => ui.openDialog("settings"),
    },
    {
      id: "help.appearance",
      title: "Appearance settings…",
      group: "Help",
      icon: SlidersHorizontal,
      keywords: "theme font size",
      run: () => ui.openDialog("settings", { section: "appearance" }),
    },
    {
      id: "help.shortcuts",
      title: "Keyboard shortcuts",
      group: "Help",
      shortcut: "Mod+/",
      icon: Keyboard,
      keywords: "keys hotkeys help",
      when: () => !isMobile,
      run: () => ui.openDialog("shortcuts"),
    },
    {
      id: "help.updates",
      title: "Check for updates…",
      group: "Help",
      icon: Download,
      keywords: "version release upgrade new",
      when: () => !isMobile,
      run: () => {
        ui.openDialog("settings", { section: "about" });
        return useUpdateStore.getState().check();
      },
    },
    {
      id: "help.about",
      title: "About git-notes",
      group: "Help",
      icon: Info,
      keywords: "version",
      run: () => ui.openDialog("settings", { section: "about" }),
    },
  ];
  return commands;
}

/** Commands that make sense right now, in group order. */
export function availableCommands(): Command[] {
  return listCommands()
    .filter((c) => c.when?.() ?? true)
    .sort((a, b) => groupOrder(a.group) - groupOrder(b.group));
}

/**
 * One global keydown handler for every command with a shortcut. Returns the uninstaller.
 * The editor's own keymap (Mod+B, Mod+S, …) runs first because it stops propagation.
 */
export function installShortcuts(): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (!event.ctrlKey && !event.metaKey && event.key !== "F2") return;
    for (const command of listCommands()) {
      if (!command.shortcut || !matchesShortcut(event, command.shortcut)) continue;
      if (command.when && !command.when()) return;
      event.preventDefault();
      void command.run();
      return;
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/** Editor-internal keys that are not commands but belong in the shortcuts help. */
export const editorShortcuts: { title: string; shortcut: string }[] = [
  { title: "Bold", shortcut: "Mod+B" },
  { title: "Italic", shortcut: "Mod+I" },
  { title: "Inline code", shortcut: "Mod+E" },
  { title: "Find in note", shortcut: "Mod+F" },
  { title: "Indent / outdent list item", shortcut: "Tab / Shift+Tab" },
];
