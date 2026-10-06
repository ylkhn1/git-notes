/**
 * Shortcuts by physical key. With a non-Latin layout (Russian, Greek, …) `event.key` is the
 * layout's character (`р` for the H key), so `Ctrl+Р` would match no `Mod+H` binding.
 * `event.code` still names the key position, which a US layout labels with the Latin key.
 */

const PUNCTUATION: Record<string, [key: string, shifted: string, keyCode: number]> = {
  Minus: ["-", "_", 189],
  Equal: ["=", "+", 187],
  BracketLeft: ["[", "{", 219],
  BracketRight: ["]", "}", 221],
  Backslash: ["\\", "|", 220],
  Semicolon: [";", ":", 186],
  Quote: ["'", '"', 222],
  Backquote: ["`", "~", 192],
  Comma: [",", "<", 188],
  Period: [".", ">", 190],
  Slash: ["/", "?", 191],
};

const SHIFTED_DIGITS = ")!@#$%^&*(";

/** The US-layout character for a physical key (`KeyH` → `h`, `Comma` → `,`), or null. */
export function latinKeyForCode(code: string, shift = false): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    const letter = code.slice(3);
    return shift ? letter : letter.toLowerCase();
  }
  if (/^Digit\d$/.test(code)) {
    const digit = code.slice(5);
    return shift ? (SHIFTED_DIGITS[Number(digit)] ?? digit) : digit;
  }
  const punctuation = PUNCTUATION[code];
  if (!punctuation) return null;
  return shift ? punctuation[1] : punctuation[0];
}

function keyCodeFor(code: string): number {
  if (/^(Key[A-Z]|Digit\d)$/.test(code)) return code.charCodeAt(code.length - 1);
  return PUNCTUATION[code]?.[2] ?? 0;
}

/** A single printable character outside ASCII: a letter of a non-Latin layout. */
export function isNonLatinKey(key: string): boolean {
  const code = key.codePointAt(0) ?? 0;
  return code > 127 && key.length === (code > 0xffff ? 2 : 1);
}

/**
 * A Ctrl/⌘ key press typed with a non-Latin layout, re-made with the Latin key in its
 * place, for keymaps written as `Mod-b`. Null when the press needs no translation. Alt
 * alone is left alone: on macOS Option types characters.
 */
export function latinKeyEvent(event: KeyboardEvent): KeyboardEvent | null {
  if (!(event.ctrlKey || event.metaKey) || !isNonLatinKey(event.key)) return null;
  const key = latinKeyForCode(event.code, event.shiftKey);
  if (!key) return null;
  const copy = new KeyboardEvent(event.type, {
    key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  });
  // CodeMirror falls back to `keyCode` for shifted keys; the constructor cannot set it.
  Object.defineProperty(copy, "keyCode", { value: keyCodeFor(event.code) });
  return copy;
}
