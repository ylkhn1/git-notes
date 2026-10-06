import { create } from "zustand";

import { commands } from "@/lib/bindings";
import { unwrap } from "@/lib/result";

/** The version a note is compared with while its changes are shown inline. */
export interface CompareTarget {
  /** The note (current path). */
  path: string;
  commitId: string;
  /** The note's path in that commit (differs before a rename). */
  versionPath: string;
  /** Read the commit's first parent: "the version before this commit". */
  before: boolean;
  /** When that version was committed; null when comparing with "nothing yet". */
  timeMs: number | null;
}

interface ChangesState {
  compare: CompareTarget | null;
  show: (target: CompareTarget) => void;
  hide: () => void;
}

/**
 * Inline diff state. Without a compare target the editor still marks uncommitted changes
 * (against `HEAD`) in the margin; with one it also shows the removed lines.
 */
export const useChangesStore = create<ChangesState>((set) => ({
  compare: null,
  show: (compare) => set({ compare }),
  hide: () => set({ compare: null }),
}));

/**
 * Picks the most useful version to compare `path` with: the last commit when the note has
 * uncommitted edits, otherwise the version before the last commit (auto-sync commits every
 * edit within a minute, so "uncommitted" is usually empty).
 */
export async function defaultCompareTarget(
  notebookId: string,
  path: string,
  currentText: string,
): Promise<CompareTarget | null> {
  const history = await unwrap(commands.listNoteHistory(notebookId, path, 2));
  const latest = history[0];
  if (!latest) return null;
  if (latest.kind !== "deleted") {
    const head = await unwrap(
      commands.getFileVersion(notebookId, latest.path, latest.commit.id, false),
    );
    if (head.text !== null && head.text !== currentText) {
      return {
        path,
        commitId: latest.commit.id,
        versionPath: latest.path,
        before: false,
        timeMs: latest.commit.timeMs,
      };
    }
  }
  const previous = history[1];
  return {
    path,
    commitId: latest.commit.id,
    versionPath: previous?.path ?? latest.path,
    before: true,
    timeMs: previous ? previous.commit.timeMs : null,
  };
}
