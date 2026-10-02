import { AlertCircle, Check, CloudOff, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { countWords } from "@/lib/text";

import { isDirty, selectActiveTab, useEditorStore } from "@/features/editor/store";

/** Bottom bar: sync state (local only until Phase 2), save state, word count. */
export function StatusBar() {
  const tab = useEditorStore(selectActiveTab);
  const words = useMemo(() => (tab ? countWords(tab.text) : 0), [tab]);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-surface px-3 text-xs text-muted-text select-none">
      <span className="inline-flex items-center gap-1.5" title="Git sync arrives in the next phase">
        <CloudOff className="size-3.5" aria-hidden="true" />
        Local only
      </span>
      {tab && <SaveState saving={tab.saving} dirty={isDirty(tab)} error={tab.saveError} />}
      <span className="flex-1" />
      {tab && (
        <span className="tabular-nums" aria-live="off">
          {words.toLocaleString()} {words === 1 ? "word" : "words"}
        </span>
      )}
    </footer>
  );
}

function SaveState({
  saving,
  dirty,
  error,
}: {
  saving: boolean;
  dirty: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-danger" role="alert" title={error}>
        <AlertCircle className="size-3.5" aria-hidden="true" /> Save failed
      </span>
    );
  }
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Saving…
      </span>
    );
  }
  if (dirty) {
    return <span className="inline-flex items-center gap-1.5">Unsaved</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="size-3.5" aria-hidden="true" /> Saved
    </span>
  );
}
