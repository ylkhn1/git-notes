import type { EditorFont, ThemeMode } from "@/lib/bindings";

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Resolves "system" to the concrete theme currently preferred by the OS. */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return darkQuery().matches ? "dark" : "light";
  return mode;
}

/** Writes the theme to <html data-theme>; CSS tokens switch on that attribute. */
export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

export function applyEditorFont(font: EditorFont, sizePx: number) {
  const root = document.documentElement;
  root.dataset.editorFont = font;
  root.style.setProperty("--gn-editor-size", `${String(sizePx)}px`);
}

/** Re-applies "system" when the OS theme flips while the app is open. */
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  const query = darkQuery();
  const handler = () => {
    if (getMode() === "system") applyTheme("system");
  };
  query.addEventListener("change", handler);
  return () => {
    query.removeEventListener("change", handler);
  };
}
