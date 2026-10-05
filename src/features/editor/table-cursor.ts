import { create } from "zustand";

/** Whether the active editor's cursor is in a table; the mobile toolbar shows table actions. */
export const useTableCursor = create<{ inTable: boolean }>(() => ({ inTable: false }));

export function setCursorInTable(inTable: boolean) {
  if (useTableCursor.getState().inTable !== inTable) useTableCursor.setState({ inTable });
}
