import { defineMessages } from "../core";

/** Credentials dialog and settings section (`features/sync/CredentialsDialog.tsx`). */
export default defineMessages({
  en: {
    title: "Credentials",
    description: "Stored in the system credential store, never in config files.",
    loading: "Loading credentials",
    storeUnavailable:
      "The system credential store is unavailable: {error}. On Linux install a Secret Service provider (KWallet or GNOME Keyring) and sign in again.",
    storeErrorUnknown: "unknown error",
    store: "Store: {backend}",

    // SSH key
    sshKey: "SSH key",
    publicKey: "Public key",
    keyCreatedHint:
      "Created {date}. Add this public key to your git host (GitHub: Settings → SSH keys, or a deploy key with write access).",
    copyPublicKey: "Copy public key",
    regenerate: "Regenerate",
    noKeyYet: "No key yet. Generate one for this device and add the public key to your git host.",
    generateKey: "Generate key",
    deleteKeyTitle: "Delete the SSH key?",
    replaceKeyTitle: "Replace the SSH key?",
    replaceKeyWarning:
      "Remotes that trust the current public key will stop accepting this device until you add the new key.",

    // HTTPS tokens
    httpsTokens: "HTTPS tokens",
    anyUser: "any user",
    savedOn: "saved {date}",
    deleteTokenFor: "Delete token for {host}",
    host: "Host",
    usernameOptional: "Username (optional)",
    personalAccessToken: "Personal access token",
    tokenPlaceholder: "needs repository read/write access",
    saveToken: "Save token",

    // Known hosts
    knownSshHosts: "Known SSH hosts",
    forget: "Forget",
    knownHostsHint:
      "The first key a host presents is trusted and remembered; a different key later is rejected.",
  },
  ru: {
    title: "Учётные данные",
    description: "Хранятся в системном хранилище учётных данных, а не в файлах настроек.",
    loading: "Загрузка учётных данных",
    storeUnavailable:
      "Системное хранилище учётных данных недоступно: {error}. В Linux установите провайдер Secret Service (KWallet или GNOME Keyring) и войдите в систему заново.",
    storeErrorUnknown: "неизвестная ошибка",
    store: "Хранилище: {backend}",

    sshKey: "SSH-ключ",
    publicKey: "Публичный ключ",
    keyCreatedHint:
      "Создан {date}. Добавьте этот публичный ключ на свой git-хост (GitHub: Settings → SSH keys либо deploy key с правом записи).",
    copyPublicKey: "Копировать публичный ключ",
    regenerate: "Создать заново",
    noKeyYet:
      "Ключа ещё нет. Создайте его для этого устройства и добавьте публичный ключ на свой git-хост.",
    generateKey: "Создать ключ",
    deleteKeyTitle: "Удалить SSH-ключ?",
    replaceKeyTitle: "Заменить SSH-ключ?",
    replaceKeyWarning:
      "Репозитории, которым известен текущий публичный ключ, перестанут принимать это устройство, пока вы не добавите новый ключ.",

    httpsTokens: "HTTPS-токены",
    anyUser: "любой пользователь",
    savedOn: "сохранён {date}",
    deleteTokenFor: "Удалить токен для {host}",
    host: "Хост",
    usernameOptional: "Имя пользователя (необязательно)",
    personalAccessToken: "Персональный токен доступа",
    tokenPlaceholder: "нужен доступ к репозиторию на чтение и запись",
    saveToken: "Сохранить токен",

    knownSshHosts: "Известные SSH-хосты",
    forget: "Забыть",
    knownHostsHint:
      "Первый ключ, который предъявляет хост, принимается и запоминается; другой ключ позже будет отклонён.",
  },
});
