import type { EditorView } from "@codemirror/view";

import { commands } from "@/lib/bindings";
import { unwrap } from "@/lib/result";

import { insertAtCursor } from "./cm/setup";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export const isImagePath = (path: string) => IMAGE_EXT.test(path);

/** Pasted images: bytes travel over IPC and are stored under `assets/`. */
export async function pasteImages(
  notebookId: string,
  notePath: string,
  files: File[],
  view: EditorView,
) {
  for (const file of files) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const name =
      file.name && file.name !== "image.png"
        ? file.name
        : `pasted-${timestamp()}.${extFor(file.type)}`;
    const saved = await unwrap(commands.saveAsset(notebookId, notePath, name, bytes));
    insertAtCursor(view, saved.markdown);
  }
}

/** Dropped files already live on disk: Rust copies them, no bytes cross IPC. */
export async function dropFiles(
  notebookId: string,
  notePath: string,
  paths: string[],
  view: EditorView,
) {
  for (const path of paths.filter(isImagePath)) {
    const saved = await unwrap(commands.importAsset(notebookId, notePath, path));
    insertAtCursor(view, saved.markdown);
  }
}

function extFor(mime: string): string {
  const ext = mime.split("/")[1] ?? "png";
  return ext === "jpeg" ? "jpg" : ext.replace(/\+.*$/, "");
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
