import { defineMessages } from "../core";

/** The graph of notes: links (and optionally tags) between notes. */
export default defineMessages({
  en: {
    open: "Graph of notes",
    title: "Graph of notes",
    description: "Notes and the links between them. Drag to move, scroll or pinch to zoom.",
    scopeAll: "Whole notebook",
    scopeLocal: "Around this note",
    depth: "Depth",
    showTags: "Tags",
    showOrphans: "Unlinked notes",
    stats: "{notes} · {links}",
    notesCount: { one: "{count} note", other: "{count} notes" },
    linksCount: { one: "{count} link", other: "{count} links" },
    empty: "No links yet. Link notes with [[Note name]] to see them here.",
    loading: "Collecting links…",
    resetView: "Fit to view",
  },
  ru: {
    open: "Граф заметок",
    title: "Граф заметок",
    description: "Заметки и связи между ними. Перетаскивайте, колесо или щипок — масштаб.",
    scopeAll: "Весь блокнот",
    scopeLocal: "Вокруг заметки",
    depth: "Глубина",
    showTags: "Теги",
    showOrphans: "Без связей",
    stats: "{notes} · {links}",
    notesCount: {
      one: "{count} заметка",
      few: "{count} заметки",
      many: "{count} заметок",
      other: "{count} заметки",
    },
    linksCount: {
      one: "{count} связь",
      few: "{count} связи",
      many: "{count} связей",
      other: "{count} связи",
    },
    empty: "Связей пока нет. Свяжите заметки через [[Название заметки]], и они появятся здесь.",
    loading: "Собираем связи…",
    resetView: "Вписать в окно",
  },
});
