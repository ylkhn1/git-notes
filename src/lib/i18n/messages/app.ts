import { defineMessages } from "../core";

/** Start-up screens (`app/App.tsx`) and the language setting. */
export default defineMessages({
  en: {
    starting: "Starting",
    couldNotStart: "git-notes could not start",
    language: "Language",
    languageHint: "System follows the language of the device.",
    languageSystem: "System",
  },
  ru: {
    starting: "Запуск",
    couldNotStart: "Не удалось запустить git-notes",
    language: "Язык",
    languageHint: "«Как в системе» — язык устройства.",
    languageSystem: "Как в системе",
  },
});
