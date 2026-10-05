import { EditorView } from "@codemirror/view";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileWarning, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";

import { notebookAssetUrl, resolveRelativePath } from "@/lib/asset-url";
import { Button } from "@/ui/button";

import { createEditorState, markdownExtensions } from "./cm/setup";
import { editorStateCache } from "./cm/state-cache";
import { revealLine, takePendingGoTo } from "./goto";
import { dropFiles, pasteImages } from "./images";
import { type Tab, useEditorStore } from "./store";
import { activeEditorView } from "./view-ref";

interface EditorProps {
  tab: Tab;
}

/** Mounts one CodeMirror view and swaps editor states as the active tab changes. */
export function Editor({ tab }: EditorProps) {
  const notebookId = useEditorStore((s) => s.notebookId);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  // One view for the lifetime of the component.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions = markdownExtensions({
      onChange: (text) => {
        useEditorStore.getState().setText(tabRef.current.path, text);
      },
      onSave: () => {
        void useEditorStore.getState().save(tabRef.current.path);
      },
      onPasteImages: (files, view) => {
        const id = useEditorStore.getState().notebookId;
        if (id) void pasteImages(id, tabRef.current.path, files, view);
      },
      resolveImage: (url) => {
        if (/^https?:\/\//i.test(url)) return url;
        const id = useEditorStore.getState().notebookId;
        const rel = resolveRelativePath(tabRef.current.path, url);
        return id && rel ? notebookAssetUrl(id, rel) : null;
      },
    });
    const view = new EditorView({ parent: host, state: createEditorState("", extensions) });
    viewRef.current = view;
    activeEditorView.set(view);
    // Stash extensions on the view for state (re)creation below.
    (view as EditorView & { gnExtensions?: typeof extensions }).gnExtensions = extensions;
    return () => {
      if (activeEditorView.get() === view) activeEditorView.set(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Swap state when the active file (or its on-disk version) changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || tab.status !== "ready") return;
    const extensions = (view as EditorView & { gnExtensions?: unknown }).gnExtensions as Parameters<
      typeof createEditorState
    >[1];
    const cached = editorStateCache.get(tab.path, tab.reloadVersion);
    const state = cached ?? createEditorState(tab.text, extensions);
    view.setState(state);
    view.focus();
    const line = takePendingGoTo(tab.path);
    if (line !== null) revealLine(view, line);
    return () => {
      editorStateCache.set(tab.path, tab.reloadVersion, view.state);
    };
    // Only the identity of the file and its reload version matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.path, tab.reloadVersion, tab.status]);

  // Files dropped from the OS arrive through Tauri, not the DOM.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop" || !notebookId || !viewRef.current) return;
        void dropFiles(notebookId, tabRef.current.path, event.payload.paths, viewRef.current);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [notebookId]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {tab.externallyChanged && <ExternalChangeBanner tab={tab} />}
      {tab.status === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <FileWarning className="size-8 text-muted-text" aria-hidden="true" />
          <p className="text-base font-medium">Could not open {tab.title}</p>
          <p className="max-w-sm text-sm text-muted-text">{tab.error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const id = useEditorStore.getState().notebookId;
              if (id)
                void useEditorStore
                  .getState()
                  .close(tab.path)
                  .then(() => useEditorStore.getState().open(id, tab.path));
            }}
          >
            <RefreshCw data-icon="inline-start" /> Try again
          </Button>
        </div>
      )}
      {tab.status === "loading" && (
        <div
          className="mx-auto w-full max-w-[70ch] space-y-3 px-6 pt-10"
          aria-busy="true"
          aria-label="Loading note"
        >
          <div className="h-7 w-2/3 animate-pulse rounded-md bg-surface-2" />
          <div className="h-4 w-full animate-pulse rounded-md bg-surface-2" />
          <div className="h-4 w-11/12 animate-pulse rounded-md bg-surface-2" />
          <div className="h-4 w-4/5 animate-pulse rounded-md bg-surface-2" />
        </div>
      )}
      <div
        ref={hostRef}
        className="min-h-0 flex-1 overflow-hidden"
        hidden={tab.status !== "ready"}
        aria-label={`${tab.title} editor`}
      />
    </div>
  );
}

function ExternalChangeBanner({ tab }: { tab: Tab }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-line bg-warning/10 px-4 py-2 text-sm text-text"
    >
      <span className="flex-1">
        <strong>{tab.title}</strong> changed on disk while you were editing.
      </span>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          void useEditorStore.getState().reloadFromDisk(tab.path);
        }}
      >
        Reload from disk
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          void useEditorStore.getState().save(tab.path);
        }}
      >
        Keep mine
      </Button>
    </div>
  );
}
