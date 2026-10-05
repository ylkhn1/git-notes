import { defineMessages } from "../core";

/** Notebook list (`Welcome`), the new-notebook dialog and native folder-picker titles. */
export default defineMessages({
  en: {
    tagline: "Plain Markdown files in a folder, synced with git across your devices.",
    newNotebook: "New notebook",
    cloneRepository: "Clone repository",
    openFolder: "Open folder",
    loadingNotebooks: "Loading notebooks",
    recent: "Recent",
    optionsFor: "Options for {name}",
    removeFromList: "Remove from list",
    removeHint: "Removing a notebook from the list keeps its files on disk.",
    newNotebookDescription: "A notebook is a folder of Markdown files.",
    name: "Name",
    nameRequired: "Name is required",
    nameNoSlashes: "Name cannot contain slashes",
    openFolderDialogTitle: "Open notebook folder",
  },
  ru: {
    tagline:
      "Обычные Markdown-файлы в папке, синхронизируемые через git между вашими устройствами.",
    newNotebook: "Новый блокнот",
    cloneRepository: "Клонировать репозиторий",
    openFolder: "Открыть папку",
    loadingNotebooks: "Загрузка блокнотов",
    recent: "Недавние",
    optionsFor: "Параметры: {name}",
    removeFromList: "Убрать из списка",
    removeHint: "Блокнот, убранный из списка, остаётся на диске.",
    newNotebookDescription: "Блокнот — это папка с Markdown-файлами.",
    name: "Название",
    nameRequired: "Укажите название",
    nameNoSlashes: "Название не может содержать косую черту",
    openFolderDialogTitle: "Открыть папку блокнота",
  },
});
