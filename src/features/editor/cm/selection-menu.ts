/**
 * Floating formatting menu above a non-empty selection (desktop). It is hidden while the
 * mouse button is held (so it does not jump around during a drag) and while the editor is
 * not focused. The contents are rendered by the caller (`mount`), so this module stays free
 * of React.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip, ViewPlugin } from "@codemirror/view";

const setFocused = StateEffect.define<boolean>();

const focused = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFocused)) value = effect.value;
    return value;
  },
});

/** Renders the menu into `dom`; returns a cleanup function. */
export type MountMenu = (dom: HTMLElement, view: EditorView) => () => void;

const DRAGGING = "cm-gn-dragging";

export function selectionMenu(mount: MountMenu): Extension {
  // One `create` per editor so CodeMirror reuses the tooltip while the selection changes.
  const create = (view: EditorView) => {
    const dom = document.createElement("div");
    dom.className = "cm-gn-selection-menu";
    const unmount = mount(dom, view);
    return { dom, destroy: unmount };
  };

  const menu = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, tr) {
      const range = tr.state.selection.main;
      if (range.empty || !tr.state.field(focused)) return null;
      if (value && !tr.selection && !tr.docChanged) return value;
      return { pos: range.from, end: range.to, above: true, strictSide: false, create };
    },
    provide: (field) => showTooltip.from(field),
  });

  // Mark the editor while a mouse selection is in progress; plain DOM, no transactions, so
  // CodeMirror's own mouse handling is untouched.
  const drag = ViewPlugin.define((view) => {
    const down = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(".cm-tooltip")) return;
      view.dom.classList.add(DRAGGING);
    };
    const up = () => {
      view.dom.classList.remove(DRAGGING);
    };
    view.contentDOM.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
    return {
      destroy: () => {
        view.contentDOM.removeEventListener("mousedown", down);
        window.removeEventListener("mouseup", up);
      },
    };
  });

  return [
    focused,
    menu,
    drag,
    EditorView.focusChangeEffect.of((_state, isFocused) => setFocused.of(isFocused)),
    EditorView.baseTheme({
      ".cm-tooltip.cm-gn-selection-menu": {
        border: "none",
        background: "transparent",
      },
      [`&.${DRAGGING} .cm-tooltip.cm-gn-selection-menu`]: {
        visibility: "hidden",
      },
    }),
  ];
}
