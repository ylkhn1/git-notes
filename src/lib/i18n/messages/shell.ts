import { defineMessages } from "../core";

/** Window chrome: title bar, sidebar, tab bar, status bar and the mobile shell. */
export default defineMessages({
  en: {
    // Sidebar and notebook switcher (desktop and mobile)
    sidebar: "Sidebar",
    notebooks: "Notebooks",
    newNotebook: "New notebook…",
    cloneRepository: "Clone repository…",
    openFolder: "Open folder…",
    settings: "Settings…",
    closeNotebook: "Close notebook",
    goToNote: "Go to note ({shortcut})",
    newNoteShortcut: "New note ({shortcut})",
    resizeSidebar: "Resize sidebar",

    // Title bar
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    close: "Close",

    // Tabs
    openNotes: "Open notes",
    closeTab: "Close {title}",
    closeTabUnsaved: "Close {title} (unsaved changes will be saved)",

    // Status bar
    /** `count` picks the form; `words` is the number formatted for the locale. */
    words: { one: "{words} word", other: "{words} words" },
    saveFailed: "Save failed",
    saving: "Saving…",
    unsaved: "Unsaved",
    saved: "Saved",

    // Desktop editor area
    editor: "Editor",
    emptyEditor:
      "Select a note, or press {newNote} to create one. {goTo} opens any note, {palette} lists every command.",

    // Mobile
    openNotesList: "Open notes",
    searchNotes: "Search notes",
    emptyMobile: "Open a note from the list or create a new one.",
    notes: "Notes",
    newNote: "New note",
    newFolder: "New folder",
    drawerDescription: "Notebook switcher and file tree",
  },
  ru: {
    sidebar: "Боковая панель",
    notebooks: "Блокноты",
    newNotebook: "Новый блокнот…",
    cloneRepository: "Клонировать репозиторий…",
    openFolder: "Открыть папку…",
    settings: "Настройки…",
    closeNotebook: "Закрыть блокнот",
    goToNote: "Перейти к заметке ({shortcut})",
    newNoteShortcut: "Новая заметка ({shortcut})",
    resizeSidebar: "Изменить ширину боковой панели",

    minimize: "Свернуть",
    maximize: "Развернуть",
    restore: "Восстановить",
    close: "Закрыть",

    openNotes: "Открытые заметки",
    closeTab: "Закрыть {title}",
    closeTabUnsaved: "Закрыть {title} (несохранённые изменения будут сохранены)",

    words: {
      one: "{words} слово",
      few: "{words} слова",
      many: "{words} слов",
      other: "{words} слова",
    },
    saveFailed: "Ошибка сохранения",
    saving: "Сохранение…",
    unsaved: "Не сохранено",
    saved: "Сохранено",

    editor: "Редактор",
    emptyEditor:
      "Выберите заметку или нажмите {newNote}, чтобы создать новую. {goTo} открывает любую заметку, {palette} показывает все команды.",

    openNotesList: "Открыть список заметок",
    searchNotes: "Поиск заметок",
    emptyMobile: "Откройте заметку из списка или создайте новую.",
    notes: "Заметки",
    newNote: "Новая заметка",
    newFolder: "Новая папка",
    drawerDescription: "Выбор блокнота и дерево файлов",
  },
});
