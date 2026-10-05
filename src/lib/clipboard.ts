import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Copies text to the system clipboard, preferring the native plugin (works on Android). */
export async function copyText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

/** Reads text from the system clipboard (desktop; needs `clipboard-manager:allow-read-text`). */
export async function pasteText(): Promise<string> {
  try {
    return await readText();
  } catch {
    return navigator.clipboard.readText();
  }
}
