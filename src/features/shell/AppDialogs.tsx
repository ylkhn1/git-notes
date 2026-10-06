import { CommandPalette } from "@/features/commands/CommandPalette";
import { ShortcutsDialog } from "@/features/commands/ShortcutsDialog";
import { ConflictsDialog } from "@/features/conflicts/ConflictsDialog";
import { selectActiveTab, useEditorStore } from "@/features/editor/store";
import { GraphDialog } from "@/features/graph/GraphDialog";
import { HistoryDialog } from "@/features/history/HistoryDialog";
import { NewNotebookDialog } from "@/features/notebooks/NewNotebookDialog";
import { useNotebooksStore } from "@/features/notebooks/store";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { CloneDialog } from "@/features/sync/CloneDialog";
import { CredentialsDialog } from "@/features/sync/CredentialsDialog";
import { RemoteDialog } from "@/features/sync/RemoteDialog";
import { UpdateDialog } from "@/features/updates/UpdateDialog";

import { useUiStore } from "./ui-store";

/** Every global overlay, mounted once at the app root and driven by the UI store. */
export function AppDialogs() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const notebook = useNotebooksStore((s) => s.current);
  const activePath = useEditorStore((s) => selectActiveTab(s)?.path ?? null);
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };

  return (
    <>
      <CommandPalette />
      <SettingsDialog />
      <ShortcutsDialog />
      <UpdateDialog />
      <NewNotebookDialog open={dialog === "newNotebook"} onOpenChange={onOpenChange} />
      <CloneDialog open={dialog === "clone"} onOpenChange={onOpenChange} />
      <CredentialsDialog open={dialog === "credentials"} onOpenChange={onOpenChange} />
      {notebook && (
        <>
          <RemoteDialog open={dialog === "remote"} onOpenChange={onOpenChange} />
          <HistoryDialog
            open={dialog === "history"}
            onOpenChange={onOpenChange}
            notebookId={notebook.id}
            path={activePath}
          />
          <GraphDialog
            open={dialog === "graph"}
            onOpenChange={onOpenChange}
            notebookId={notebook.id}
          />
          <ConflictsDialog />
        </>
      )}
    </>
  );
}
