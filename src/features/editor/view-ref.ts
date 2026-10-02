import type { EditorView } from "@codemirror/view";

/** The mounted CodeMirror view, for toolbars that live outside the editor component. */
let current: EditorView | null = null;

export const activeEditorView = {
  get: () => current,
  set: (view: EditorView | null) => {
    current = view;
  },
};
