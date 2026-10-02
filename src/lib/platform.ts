/** Platform detection without touching Tauri APIs during render. */

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

/** True when running inside the Android WebView (single-pane layout, no title bar). */
export const isAndroid = /android/i.test(ua);

/** True on any touch-first mobile platform. */
export const isMobile = isAndroid || /iphone|ipad/i.test(ua);

/** Desktop builds draw their own title bar (`decorations: false`). */
export const hasCustomTitleBar = !isMobile;

export const isMac = /mac/i.test(ua) && !isMobile;

/** Modifier key label for shortcuts hints. */
export const modKey = isMac ? "⌘" : "Ctrl";
