import { defineMessages } from "../core";

/** Wiki links between notes: the backlinks strip under the editor. */
export default defineMessages({
  en: {
    backlinks: "Links to this note",
    loading: "Looking for links to this note…",
    none: "No other notes link here",
    count: {
      one: "{count} link to this note from {notes}",
      other: "{count} links to this note from {notes}",
    },
    notesCount: { one: "{count} note", other: "{count} notes" },
  },
  ru: {
    backlinks: "Ссылки на эту заметку",
    loading: "Ищем ссылки на эту заметку…",
    none: "Другие заметки сюда не ссылаются",
    count: {
      one: "{count} ссылка на эту заметку из {notes}",
      few: "{count} ссылки на эту заметку из {notes}",
      many: "{count} ссылок на эту заметку из {notes}",
      other: "{count} ссылки на эту заметку из {notes}",
    },
    notesCount: {
      one: "{count} заметки",
      few: "{count} заметок",
      many: "{count} заметок",
      other: "{count} заметки",
    },
  },
});
