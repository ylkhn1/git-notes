import { defineMessages } from "../core";

/** Clone repository dialog (`features/sync/CloneDialog.tsx`). */
export default defineMessages({
  en: {
    title: "Clone repository",
    description: "Open an existing notebook from a git remote.",
    repositoryUrl: "Repository URL",
    folderName: "Folder name",
    urlRequired: "Repository URL is required",
    folderNameNoSlashes: "Folder name cannot contain slashes",
    clone: "Clone",
    cloning: "Cloning…",
    connecting: "Connecting…",
    receivingObjects: "Receiving objects {received}/{total} · {bytes}",
    checkingOutFiles: "Checking out files {done}/{total}",
  },
  ru: {
    title: "Клонировать репозиторий",
    description: "Открыть существующий блокнот из удалённого git-репозитория.",
    repositoryUrl: "Адрес репозитория",
    folderName: "Имя папки",
    urlRequired: "Укажите адрес репозитория",
    folderNameNoSlashes: "Имя папки не может содержать косую черту",
    clone: "Клонировать",
    cloning: "Клонирование…",
    connecting: "Подключение…",
    receivingObjects: "Получение объектов {received}/{total} · {bytes}",
    checkingOutFiles: "Извлечение файлов {done}/{total}",
  },
});
