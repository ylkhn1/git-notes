import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Typographic highlighting for Markdown source (checkpoint 1). Keeps the text calm:
 * structure is expressed through weight and tone rather than many colours.
 */
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "700", fontSize: "1.6em", lineHeight: "1.25" },
  { tag: tags.heading2, fontWeight: "700", fontSize: "1.35em", lineHeight: "1.3" },
  { tag: tags.heading3, fontWeight: "650", fontSize: "1.15em" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "650" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--gn-text-muted)" },
  {
    tag: tags.link,
    color: "var(--gn-accent)",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  { tag: tags.url, color: "var(--gn-text-muted)" },
  { tag: tags.quote, color: "var(--gn-text-muted)", fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.9em" },
  { tag: tags.processingInstruction, color: "var(--gn-text-faint)" },
  { tag: tags.labelName, color: "var(--gn-text-muted)" },
  { tag: tags.contentSeparator, color: "var(--gn-text-faint)" },
  // Fenced code block content
  { tag: tags.keyword, color: "var(--gn-accent)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--gn-success)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--gn-warning)" },
  { tag: tags.comment, color: "var(--gn-text-muted)", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--gn-text)",
  },
  { tag: [tags.typeName, tags.className], color: "var(--gn-danger)" },
]);
