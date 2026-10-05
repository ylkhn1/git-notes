import { defineMessages } from "../core";

/** Remote & git setup dialog (`features/sync/RemoteDialog.tsx`), including the URL hints reused by Clone. */
export default defineMessages({
  en: {
    title: "Remote & git setup",
    description: "Where this notebook syncs to.",
    notARepoYet: "This folder is not a git repository yet. Initialize one to enable sync.",
    initializeGit: "Initialize git",
    remoteUrl: "Remote URL",
    settingsNote:
      "Author, device name and automatic sync apply to every notebook and live in <link>Settings → Sync & identity</link>.",

    // RemoteHint
    hintKeepLocal: "Leave empty to keep this notebook local.",
    hintSshKey: "SSH · uses this device’s key ({fingerprint}…).",
    hintSshNoKey: "SSH · no key yet — generate one under Credentials and add it to {host}.",
    theHost: "the host",
    hintHttpsToken: "HTTPS · token for {host} saved.",
    hintHttpsTokenUser: "HTTPS · token for {host} saved ({username}).",
    hintHttpsNoToken:
      "HTTPS · no token saved for {host} — needed to push (clone works for public repos).",
    thisHost: "this host",
    hintLocalPath: "Local path · no credentials needed.",
    hintNotGitUrl: "Not a recognised git URL.",
  },
  ru: {
    title: "Удалённый репозиторий и git",
    description: "Куда синхронизируется этот блокнот.",
    notARepoYet:
      "Эта папка ещё не git-репозиторий. Инициализируйте его, чтобы включить синхронизацию.",
    initializeGit: "Инициализировать git",
    remoteUrl: "Адрес репозитория",
    settingsNote:
      "Автор, имя устройства и автосинхронизация общие для всех блокнотов и задаются в разделе <link>Настройки → Синхронизация и автор</link>.",

    hintKeepLocal: "Оставьте пустым, чтобы блокнот остался локальным.",
    hintSshKey: "SSH · используется ключ этого устройства ({fingerprint}…).",
    hintSshNoKey: "SSH · ключа ещё нет — создайте его в «Учётных данных» и добавьте на {host}.",
    theHost: "хост",
    hintHttpsToken: "HTTPS · токен для {host} сохранён.",
    hintHttpsTokenUser: "HTTPS · токен для {host} сохранён ({username}).",
    hintHttpsNoToken:
      "HTTPS · токен для {host} не сохранён — он нужен для отправки (публичные репозитории клонируются и без него).",
    thisHost: "этого хоста",
    hintLocalPath: "Локальный путь · учётные данные не нужны.",
    hintNotGitUrl: "Не похоже на адрес git-репозитория.",
  },
});
