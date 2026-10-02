import { FileText } from "lucide-react";
import { useEffect, useState } from "react";

import { hasCustomTitleBar } from "@/lib/platform";
import { parentOf } from "@/lib/paths";

import { Editor } from "@/features/editor/Editor";
import { selectActiveTab, useEditorStore } from "@/features/editor/store";
import { NewNotebookDialog } from "@/features/notebooks/NewNotebookDialog";
import { useNotebooksStore } from "@/features/notebooks/store";
import { findNode, useTreeStore } from "@/features/tree/store";

import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TitleBar } from "./TitleBar";

/** Desktop layout: title bar / sidebar + editor / status bar. */
export function DesktopShell() {
  const notebook = useNotebooksStore((s) => s.current);
  const tab = useEditorStore(selectActiveTab);
  const [newNotebookOpen, setNewNotebookOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "w" || e.key === "W") {
        const active = useEditorStore.getState().activePath;
        if (active) {
          e.preventDefault();
          void useEditorStore.getState().close(active);
        }
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        const tree = useTreeStore.getState();
        const current = useNotebooksStore.getState().current;
        if (!current) return;
        const node = tree.selectedPath ? findNode(tree.nodes, tree.selectedPath) : undefined;
        const dir = node ? (node.kind === "dir" ? node.path : parentOf(node.path)) : "";
        void tree.createNote(dir).then((path) => useEditorStore.getState().open(current.id, path));
      } else if (e.key === "s" || e.key === "S") {
        // CodeMirror handles Mod-S when focused; this covers the rest of the window.
        e.preventDefault();
        void useEditorStore.getState().saveAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!notebook) return null;

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {hasCustomTitleBar && (
        <TitleBar
          title={tab ? tab.title : notebook.name}
          subtitle={tab ? notebook.name : undefined}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar onNewNotebook={() => setNewNotebookOpen(true)} />
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Editor">
          <TabBar />
          <div className="min-h-0 flex-1">
            {tab ? <Editor key={tab.path} tab={tab} /> : <EmptyEditor />}
          </div>
        </section>
      </div>
      <StatusBar />
      <NewNotebookDialog open={newNotebookOpen} onOpenChange={setNewNotebookOpen} />
    </div>
  );
}

function EmptyEditor() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-text">
      <FileText className="size-8 text-faint" aria-hidden="true" />
      <p className="text-sm">Select a note, or press Ctrl+N to create one.</p>
    </div>
  );
}
