import { defineMessages } from "../core";

/** Keyboard shortcuts help and the editor-only keys listed there. */
export default defineMessages({
  en: {
    title: "Keyboard shortcuts",
    description: "Press {shortcut} for every command.",
    editorGroup: "Editor",
    bold: "Bold",
    italic: "Italic",
    inlineCode: "Inline code",
    findInNote: "Find in note",
    indentListItem: "Indent / outdent list item",
  },
  ru: {
    title: "Сочетания клавиш",
    description: "{shortcut} — все команды.",
    editorGroup: "Редактор",
    bold: "Жирный",
    italic: "Курсив",
    inlineCode: "Код в строке",
    findInNote: "Найти в заметке",
    indentListItem: "Сдвинуть пункт списка вправо / влево",
  },
});
