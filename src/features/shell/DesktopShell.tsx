import { FileText } from "lucide-react";

import { hasCustomTitleBar } from "@/lib/platform";
import { formatShortcut } from "@/lib/shortcuts";

import { ConflictBanner } from "@/features/conflicts/ConflictBanner";
import { Editor } from "@/features/editor/Editor";
import { selectActiveTab, useEditorStore } from "@/features/editor/store";
import { useNotebooksStore } from "@/features/notebooks/store";
import { UpdateBanner } from "@/features/updates/UpdateBanner";

import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TitleBar } from "./TitleBar";

/** Desktop layout: title bar / sidebar + editor / status bar. */
export function DesktopShell() {
  const notebook = useNotebooksStore((s) => s.current);
  const tab = useEditorStore(selectActiveTab);
  if (!notebook) return null;

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {hasCustomTitleBar && (
        <TitleBar
          title={tab ? tab.title : notebook.name}
          subtitle={tab ? notebook.name : undefined}
        />
      )}
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Editor">
          <TabBar />
          <ConflictBanner />
          <div className="min-h-0 flex-1">
            {tab ? <Editor key={tab.path} tab={tab} /> : <EmptyEditor />}
          </div>
        </section>
      </div>
      <StatusBar />
    </div>
  );
}

function EmptyEditor() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-text">
      <FileText className="size-8 text-faint" aria-hidden="true" />
      <p className="text-sm">
        Select a note, or press {formatShortcut("Mod+N")} to create one. {formatShortcut("Mod+P")}{" "}
        opens any note, {formatShortcut("Mod+K")} lists every command.
      </p>
    </div>
  );
}
