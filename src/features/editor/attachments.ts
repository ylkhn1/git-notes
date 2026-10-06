import type { EditorView } from "@codemirror/view";

import { commands } from "@/lib/bindings";
import { parentOf } from "@/lib/paths";
import { unwrap } from "@/lib/result";

import { insertAtCursor } from "./cm/setup";
import { useEditorStore } from "./store";
import { activeEditorView } from "./view-ref";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export const isImagePath = (path: string) => IMAGE_EXT.test(path);

/** Files the editor opens as text; everything else is an attachment. */
export const isTextNotePath = (path: string) => /\.(md|markdown|txt)$/i.test(path);

/** Inserts the Markdown for new attachments at `at` (a document position) or the cursor. */
function insertSnippets(view: EditorView, snippets: string[], at?: number) {
  if (snippets.length === 0) return;
  if (at !== undefined) view.dispatch({ selection: { anchor: at } });
  insertAtCursor(view, snippets.join("\n"));
}

/**
 * Pasted or picked files: the bytes travel over IPC and are stored under `assets/`;
 * images are embedded, other files linked.
 */
export async function attachFiles(
  notebookId: string,
  notePath: string,
  files: File[],
  view: EditorView,
  at?: number,
) {
  const snippets: string[] = [];
  for (const file of files) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const name =
      file.name && file.name !== "image.png"
        ? file.name
        : `pasted-${timestamp()}.${extFor(file.type)}`;
    const saved = await unwrap(commands.saveAsset(notebookId, notePath, name, bytes));
    snippets.push(saved.markdown);
  }
  insertSnippets(view, snippets, at);
}

/** Files dropped from the file manager already live on disk: Rust copies them. */
export async function attachPaths(
  notebookId: string,
  notePath: string,
  paths: string[],
  view: EditorView,
  at?: number,
) {
  const snippets: string[] = [];
  for (const path of paths) {
    const saved = await unwrap(commands.importAsset(notebookId, notePath, path));
    snippets.push(saved.markdown);
  }
  insertSnippets(view, snippets, at);
}

/**
 * Opens the system file picker. Must be called from a user gesture (click / key press);
 * resolves with the chosen files (empty when cancelled and the webview reports it).
 */
export function pickFiles(accept?: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (accept) input.accept = accept;
    input.addEventListener("change", () => {
      resolve(Array.from(input.files ?? []));
    });
    input.addEventListener("cancel", () => {
      resolve([]);
    });
    input.click();
  });
}

/** Picks files and attaches them to the note in the active editor. */
export async function attachPickedFiles(accept?: string) {
  const files = await pickFiles(accept);
  const view = activeEditorView.get();
  const { notebookId, activePath } = useEditorStore.getState();
  if (files.length && view && notebookId && activePath) {
    await attachFiles(notebookId, activePath, files, view);
  }
}

/** A Markdown link target from note `from` to notebook file `to` (`../assets/a%20b.pdf`). */
export function relativeHref(from: string, to: string): string {
  const fromParts = parentOf(from).split("/").filter(Boolean);
  const toParts = to.split("/");
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const up = "../".repeat(fromParts.length - common);
  const rest = toParts
    .slice(common)
    .map((segment) =>
      segment.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29"),
    )
    .join("/");
  return `${up}${rest}`;
}

function extFor(mime: string): string {
  if (!mime.includes("/")) return "bin";
  const ext = mime.split("/")[1] ?? "bin";
  return ext === "jpeg" ? "jpg" : ext.replace(/\+.*$/, "");
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
