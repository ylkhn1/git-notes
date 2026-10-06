import {
  AArrowDown,
  AArrowUp,
  AlertTriangle,
  CloudDownload,
  Columns3,
  Download,
  FilePlus,
  FileSymlink,
  FileSearch,
  FolderOpen,
  FolderPlus,
  GitCompareArrows,
  History,
  Info,
  Keyboard,
  KeyRound,
  Link2,
  Languages,
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
  Table,
  Terminal,
  Trash2,
  Type,
  X,
} from "lucide-react";

import { type MessageKey, t } from "@/lib/i18n";
import { parentOf } from "@/lib/paths";
import { isMobile } from "@/lib/platform";
import { matchesShortcut } from "@/lib/shortcuts";

import { defaultCompareTarget, useChangesStore } from "@/features/editor/changes-store";
import { formatTableAtCursor, inTable, insertTable } from "@/features/editor/cm/tables";
import { insertWikiLink } from "@/features/editor/cm/wikilinks";
import { useEditorStore } from "@/features/editor/store";
import { activeEditorView } from "@/features/editor/view-ref";
import { useLinksStore } from "@/features/links/store";
import { useConflictsDialog } from "@/features/conflicts/dialog-store";
import { useNotebooksStore } from "@/features/notebooks/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUiStore } from "@/features/shell/ui-store";
import { useSyncStore } from "@/features/sync/store";
import { useTreeDialogStore } from "@/features/tree/dialog-store";
import { findNode, useTreeStore } from "@/features/tree/store";
import { useUpdateStore } from "@/features/updates/store";

export type CommandGroup = "go" | "note" | "notebook" | "sync" | "view" | "help";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** `Mod+Shift+S` form; see `lib/shortcuts.ts`. Desktop only. */
  shortcut?: string;
  icon?: LucideIcon;
  /** Extra words the palette should match, in English and Russian. */
  keywords?: string;
  /** Absent → always available. */
  when?: () => boolean;
  run: () => void | Promise<void>;
}

const GROUP_ORDER: CommandGroup[] = ["go", "note", "notebook", "sync", "view", "help"];

const GROUP_LABELS: Record<CommandGroup, MessageKey> = {
  go: "commands.groupGo",
  note: "commands.groupNote",
  notebook: "commands.groupNotebook",
  sync: "commands.groupSync",
  view: "commands.groupView",
  help: "commands.groupHelp",
};

/** Translated group heading for the palette and the shortcuts help. */
export function commandGroupLabel(group: CommandGroup): string {
  return t(GROUP_LABELS[group]);
}

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
      title: t("commands.palette"),
      group: "go",
      shortcut: "Mod+K",
      icon: Terminal,
      keywords: "actions действия команды",
      run: () => ui.openPalette("commands"),
    },
    {
      id: "go.note",
      title: t("commands.goToNote"),
      group: "go",
      shortcut: "Mod+P",
      icon: FileSearch,
      keywords: "open quick switcher file открыть заметка файл",
      when: hasNotebook,
      run: () => ui.openPalette("files"),
    },
    {
      id: "go.search",
      title: t("commands.searchInNotes"),
      group: "go",
      shortcut: "Mod+Shift+F",
      icon: Search,
      keywords: "find text grep поиск найти текст",
      when: hasNotebook,
      run: () => ui.openPalette("search"),
    },

    {
      id: "note.new",
      title: t("commands.newNote"),
      group: "note",
      shortcut: "Mod+N",
      icon: FilePlus,
      keywords: "create создать заметка",
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
      title: t("commands.save"),
      group: "note",
      shortcut: "Mod+S",
      icon: Save,
      keywords: "сохранить",
      when: hasActiveNote,
      run: () => useEditorStore.getState().saveAll(),
    },
    {
      id: "note.close",
      title: t("commands.closeTab"),
      group: "note",
      shortcut: "Mod+W",
      icon: X,
      keywords: "закрыть вкладка",
      when: () => !isMobile && hasActiveNote(),
      run: () => {
        const active = useEditorStore.getState().activePath;
        if (active) void useEditorStore.getState().close(active);
      },
    },
    {
      id: "note.rename",
      title: t("commands.renameNote"),
      group: "note",
      shortcut: "F2",
      icon: Pencil,
      keywords: "переименовать",
      when: hasActiveNote,
      run: () => {
        const active = useEditorStore.getState().activePath;
        if (active) useTreeDialogStore.getState().open({ kind: "rename", path: active });
      },
    },
    {
      id: "note.delete",
      title: t("commands.deleteNote"),
      group: "note",
      icon: Trash2,
      keywords: "remove удалить",
      when: hasActiveNote,
      run: () => {
        const active = useEditorStore.getState().activePath;
        if (active) useTreeDialogStore.getState().open({ kind: "delete", path: active });
      },
    },
    {
      id: "note.linkToNote",
      title: t("commands.linkToNote"),
      group: "note",
      icon: FileSymlink,
      keywords: "wiki link [[ backlink связь ссылка заметка",
      when: hasActiveNote,
      run: () => {
        const view = activeEditorView.get();
        if (!view) return;
        insertWikiLink(view);
        view.focus();
      },
    },
    {
      id: "note.insertTable",
      title: t("commands.insertTable"),
      group: "note",
      icon: Table,
      keywords: "table grid columns rows таблица столбцы строки",
      when: hasActiveNote,
      run: () => {
        const view = activeEditorView.get();
        if (!view) return;
        insertTable(view);
        view.focus();
      },
    },
    {
      id: "note.formatTable",
      title: t("commands.formatTable"),
      group: "note",
      icon: Columns3,
      keywords: "table align format таблица выровнять",
      when: () => {
        const view = activeEditorView.get();
        return hasActiveNote() && view !== null && inTable(view.state);
      },
      run: () => {
        const view = activeEditorView.get();
        if (!view) return;
        formatTableAtCursor(view);
        view.focus();
      },
    },
    {
      id: "note.backlinks",
      title: t("commands.showBacklinks"),
      group: "note",
      icon: Link2,
      keywords: "backlinks mentions linked обратные ссылки упоминания",
      when: hasActiveNote,
      run: () => {
        useLinksStore.getState().togglePanel(true);
      },
    },
    {
      id: "note.history",
      title: t("commands.noteHistory"),
      group: "note",
      icon: History,
      keywords: "versions diff commits история версии изменения",
      when: () => hasActiveNote() && Boolean(useSyncStore.getState().status?.isRepo),
      run: () => ui.openDialog("history", { historyScope: "note" }),
    },
    {
      id: "note.changes",
      title: useChangesStore.getState().compare
        ? t("commands.hideChanges")
        : t("commands.showChanges"),
      group: "note",
      icon: GitCompareArrows,
      keywords: "diff compare changes version сравнить изменения отличия версия",
      when: () => hasActiveNote() && Boolean(useSyncStore.getState().status?.isRepo),
      run: () => toggleChanges(),
    },

    {
      id: "notebook.new",
      title: t("commands.newNotebook"),
      group: "notebook",
      icon: FolderPlus,
      keywords: "создать блокнот",
      run: () => ui.openDialog("newNotebook"),
    },
    {
      id: "notebook.clone",
      title: t("commands.cloneRepository"),
      group: "notebook",
      icon: CloudDownload,
      keywords: "git download клонировать скачать",
      run: () => ui.openDialog("clone"),
    },
    {
      id: "notebook.open",
      title: t("commands.openFolder"),
      group: "notebook",
      icon: FolderOpen,
      keywords: "открыть папка",
      when: () => !isMobile,
      run: () => notebooks.openFolder().then(() => undefined),
    },
    ...notebooks.notebooks
      .filter((nb) => nb.id !== notebooks.current?.id)
      .map((nb): Command => ({
        id: `notebook.switch.${nb.id}`,
        title: t("commands.switchToNotebook", { name: nb.name }),
        group: "notebook",
        icon: FolderOpen,
        keywords: `${nb.path} блокнот перейти`,
        run: () => notebooks.select(nb.id),
      })),
    {
      id: "notebook.close",
      title: t("commands.closeNotebook"),
      group: "notebook",
      icon: X,
      keywords: "закрыть блокнот",
      when: hasNotebook,
      run: () => notebooks.closeCurrent(),
    },

    {
      id: "sync.now",
      title: t("commands.syncNow"),
      group: "sync",
      shortcut: "Mod+Shift+S",
      icon: RefreshCw,
      keywords: "push pull git синхронизация отправить получить",
      when: canSync,
      run: () =>
        useSyncStore
          .getState()
          .syncNow()
          .then(() => undefined),
    },
    {
      id: "sync.conflicts",
      title: t("commands.reviewConflicts"),
      group: "sync",
      icon: AlertTriangle,
      keywords: "conflict конфликт копии",
      when: () => useSyncStore.getState().conflicts.length > 0,
      run: () => useConflictsDialog.getState().show(),
    },
    {
      id: "sync.history",
      title: t("commands.notebookHistory"),
      group: "sync",
      icon: History,
      keywords: "commits log история коммиты",
      when: () => hasNotebook() && Boolean(useSyncStore.getState().status?.isRepo),
      run: () => ui.openDialog("history", { historyScope: "notebook" }),
    },
    {
      id: "sync.remote",
      title: t("commands.remoteSetup"),
      group: "sync",
      icon: Settings2,
      keywords: "url origin init удалённый репозиторий адрес",
      when: hasNotebook,
      run: () => ui.openDialog("remote"),
    },
    {
      id: "sync.credentials",
      title: t("commands.credentials"),
      group: "sync",
      icon: KeyRound,
      keywords: "ssh key token ключ токен учётные данные",
      run: () => ui.openDialog("credentials"),
    },

    {
      id: "view.theme.system",
      title: t("commands.themeSystem"),
      group: "view",
      icon: Monitor,
      keywords: "appearance auto тема оформление система",
      run: () => settings.update({ theme: "system" }),
    },
    {
      id: "view.theme.light",
      title: t("commands.themeLight"),
      group: "view",
      icon: Sun,
      keywords: "appearance тема оформление светлая",
      run: () => settings.update({ theme: "light" }),
    },
    {
      id: "view.theme.dark",
      title: t("commands.themeDark"),
      group: "view",
      icon: Moon,
      keywords: "appearance night тема оформление тёмная ночь",
      run: () => settings.update({ theme: "dark" }),
    },
    {
      id: "view.font.sans",
      title: t("commands.fontSans"),
      group: "view",
      icon: Type,
      keywords: "шрифт",
      run: () => settings.update({ editorFont: "sans" }),
    },
    {
      id: "view.font.serif",
      title: t("commands.fontSerif"),
      group: "view",
      icon: Type,
      keywords: "шрифт",
      run: () => settings.update({ editorFont: "serif" }),
    },
    {
      id: "view.font.mono",
      title: t("commands.fontMono"),
      group: "view",
      icon: Type,
      keywords: "monospace code шрифт моноширинный",
      run: () => settings.update({ editorFont: "mono" }),
    },
    {
      id: "view.text.larger",
      title: t("commands.largerText"),
      group: "view",
      shortcut: "Mod+Shift+=",
      icon: AArrowUp,
      keywords: "zoom in font size крупнее размер шрифт",
      run: () => bump(1),
    },
    {
      id: "view.text.smaller",
      title: t("commands.smallerText"),
      group: "view",
      shortcut: "Mod+-",
      icon: AArrowDown,
      keywords: "zoom out font size мельче размер шрифт",
      run: () => bump(-1),
    },
    {
      id: "view.language.system",
      title: t("commands.languageSystem"),
      group: "view",
      icon: Languages,
      keywords: "language locale язык",
      run: () => settings.update({ language: "system" }),
    },
    {
      id: "view.language.en",
      title: t("commands.languageEnglish"),
      group: "view",
      icon: Languages,
      keywords: "language locale english английский язык",
      run: () => settings.update({ language: "en" }),
    },
    {
      id: "view.language.ru",
      title: t("commands.languageRussian"),
      group: "view",
      icon: Languages,
      keywords: "language locale russian русский язык",
      run: () => settings.update({ language: "ru" }),
    },

    {
      id: "help.settings",
      title: t("commands.settings"),
      group: "help",
      shortcut: "Mod+,",
      icon: Settings,
      keywords: "preferences options настройки параметры",
      run: () => ui.openDialog("settings"),
    },
    {
      id: "help.appearance",
      title: t("commands.appearanceSettings"),
      group: "help",
      icon: SlidersHorizontal,
      keywords: "theme font size оформление тема шрифт",
      run: () => ui.openDialog("settings", { section: "appearance" }),
    },
    {
      id: "help.shortcuts",
      title: t("commands.keyboardShortcuts"),
      group: "help",
      shortcut: "Mod+/",
      icon: Keyboard,
      keywords: "keys hotkeys help клавиши сочетания справка",
      when: () => !isMobile,
      run: () => ui.openDialog("shortcuts"),
    },
    {
      id: "help.updates",
      title: t("commands.checkForUpdates"),
      group: "help",
      icon: Download,
      keywords: "version release upgrade new обновления версия",
      when: () => !isMobile,
      run: () => {
        ui.openDialog("settings", { section: "about" });
        return useUpdateStore.getState().check();
      },
    },
    {
      id: "help.about",
      title: t("commands.about"),
      group: "help",
      icon: Info,
      keywords: "version версия о программе",
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
export function editorShortcuts(): { title: string; shortcut: string }[] {
  return [
    { title: t("shortcuts.bold"), shortcut: "Mod+B" },
    { title: t("shortcuts.italic"), shortcut: "Mod+I" },
    { title: t("shortcuts.inlineCode"), shortcut: "Mod+E" },
    { title: t("shortcuts.findInNote"), shortcut: "Mod+F" },
    { title: t("shortcuts.indentListItem"), shortcut: "Tab / Shift+Tab" },
  ];
}

/** Shows the active note's changes inline (against the most useful version) or hides them. */
export async function toggleChanges() {
  const changes = useChangesStore.getState();
  if (changes.compare) {
    changes.hide();
    return;
  }
  const editor = useEditorStore.getState();
  const tab = editor.tabs.find((tab) => tab.path === editor.activePath);
  if (!editor.notebookId || !tab) return;
  const target = await defaultCompareTarget(editor.notebookId, tab.path, tab.text);
  if (target) changes.show(target);
}
