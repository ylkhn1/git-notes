import { defineMessages } from "../core";

/** First-run flow: commit identity, then the first notebook. */
export default defineMessages({
  en: {
    welcome: "Welcome to git-notes",
    firstNotebook: "Your first notebook",
    identitySubtitle:
      "Plain Markdown files in a folder, synced with git across your devices. Two quick questions first.",
    notebookSubtitle: "A notebook is a folder of Markdown files that is also a git repository.",
    yourName: "Your name",
    email: "Email",
    thisDevice: "This device",
    identityHint:
      "Every change becomes a git commit with this name and email. The device name tells your other devices where a change came from. You can edit all of this later in Settings.",
    stepOf: "Step {step} of {total}",
    skipForNow: "Skip for now",
    createNew: "Create a new notebook",
    createNewHint: "An empty folder with a starter note. Connect a git remote later.",
    cloneExisting: "Clone an existing repository",
    cloneExistingHint: "Your notes already live on GitHub, Gitea or an SSH server.",
    openFolder: "Open a folder",
    openFolderHint: "Markdown files you already have. Git is optional until you add a remote.",
  },
  ru: {
    welcome: "Добро пожаловать в git-notes",
    firstNotebook: "Ваш первый блокнот",
    identitySubtitle:
      "Обычные Markdown-файлы в папке, синхронизируемые через git между вашими устройствами. Сначала два коротких вопроса.",
    notebookSubtitle:
      "Блокнот — это папка с Markdown-файлами, которая одновременно является git-репозиторием.",
    yourName: "Ваше имя",
    email: "Эл. почта",
    thisDevice: "Это устройство",
    identityHint:
      "Каждое изменение становится git-коммитом с этим именем и почтой. Имя устройства подсказывает другим вашим устройствам, откуда пришло изменение. Всё это можно изменить позже в настройках.",
    stepOf: "Шаг {step} из {total}",
    skipForNow: "Пропустить",
    createNew: "Создать новый блокнот",
    createNewHint: "Пустая папка с первой заметкой. Удалённый репозиторий можно подключить позже.",
    cloneExisting: "Клонировать существующий репозиторий",
    cloneExistingHint: "Ваши заметки уже лежат на GitHub, Gitea или SSH-сервере.",
    openFolder: "Открыть папку",
    openFolderHint:
      "Markdown-файлы, которые у вас уже есть. Git не нужен, пока вы не добавите удалённый репозиторий.",
  },
});
