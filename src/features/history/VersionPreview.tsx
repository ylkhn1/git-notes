import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { notebookAssetUrl, resolveRelativePath } from "@/lib/asset-url";

import { livePreview } from "@/features/editor/cm/live-preview";
import { markdownHighlightStyle } from "@/features/editor/cm/markdown-theme";
import { tagSyntax } from "@/features/editor/cm/tags";
import { wikiLinkSyntax } from "@/features/editor/cm/wikilinks";

/** An old version of a note, rendered like the editor but read-only. */
export function VersionPreview({
  notebookId,
  path,
  text,
}: {
  notebookId: string;
  path: string;
  text: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        // Live preview shows raw Markdown on the selected line; park it at the very end.
        selection: EditorSelection.cursor(text.length),
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            extensions: [wikiLinkSyntax, tagSyntax],
          }),
          syntaxHighlighting(markdownHighlightStyle),
          livePreview((url) => {
            if (/^https?:\/\//i.test(url)) return url;
            const rel = resolveRelativePath(path, url);
            return rel ? notebookAssetUrl(notebookId, rel) : null;
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [notebookId, path, text]);
  return <div ref={hostRef} className="selectable [&_.cm-content]:pt-4 [&_.cm-content]:pb-8" />;
}
