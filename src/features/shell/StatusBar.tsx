import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { useLocale, useT } from "@/lib/i18n";
import { countWords } from "@/lib/text";

import { isDirty, selectActiveTab, useEditorStore } from "@/features/editor/store";
import { SyncIndicator } from "@/features/sync/SyncIndicator";

/** Bottom bar: sync state, save state, word count. */
export function StatusBar() {
  const t = useT();
  const locale = useLocale();
  const tab = useEditorStore(selectActiveTab);
  const words = useMemo(() => (tab ? countWords(tab.text) : 0), [tab]);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-surface px-1.5 text-xs text-muted-text select-none">
      <SyncIndicator variant="statusbar" />
      {tab && <SaveState saving={tab.saving} dirty={isDirty(tab)} error={tab.saveError} />}
      <span className="flex-1" />
      {tab && (
        <span className="tabular-nums" aria-live="off">
          {t("shell.words", { count: words, words: words.toLocaleString(locale) })}
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
  const t = useT();
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-danger" role="alert" title={error}>
        <AlertCircle className="size-3.5" aria-hidden="true" /> {t("shell.saveFailed")}
      </span>
    );
  }
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {t("shell.saving")}
      </span>
    );
  }
  if (dirty) {
    return <span className="inline-flex items-center gap-1.5">{t("shell.unsaved")}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="size-3.5" aria-hidden="true" /> {t("shell.saved")}
    </span>
  );
}
