import { Fragment, type ReactNode } from "react";

import { type MessageKey, type Params, t } from "./index";

/** Renders the text inside a `<tag>…</tag>` marker, e.g. as a link or a button. */
export type RichComponents = Record<string, (chunk: string) => ReactNode>;

/**
 * Translates `key` and turns `<tag>text</tag>` markers into React nodes through
 * `components`, so a sentence can contain a link without being split into fragments
 * that translators would have to reorder. Tags do not nest; a tag without a renderer
 * shows its text verbatim.
 */
export function rich(key: MessageKey, components: RichComponents, params?: Params): ReactNode {
  const text = t(key, params);
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) {
    const [whole, tag = "", inner = ""] = match;
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const render = components[tag];
    nodes.push(<Fragment key={match.index}>{render ? render(inner) : inner}</Fragment>);
    last = match.index + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
