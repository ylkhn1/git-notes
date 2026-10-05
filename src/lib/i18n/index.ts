import { create } from "zustand";

import type { Language } from "@/lib/bindings";

import {
  DEFAULT_LOCALE,
  formatMessage,
  type Locale,
  type Message,
  type Messages,
  type Params,
  resolveLocale,
} from "./core";
import { type MessageKey, namespaces } from "./messages";

export {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  LOCALES,
  type Locale,
  type Params,
  resolveLocale,
} from "./core";
export type { MessageKey } from "./messages";

interface I18nState {
  locale: Locale;
}

/** Current UI locale. Components subscribe through {@link useT} / {@link useLocale}. */
export const useI18nStore = create<I18nState>(() => ({
  locale: typeof navigator === "undefined" ? DEFAULT_LOCALE : resolveLocale("system"),
}));

export function getLocale(): Locale {
  return useI18nStore.getState().locale;
}

/** Switches the UI language; `<html lang>` follows so spell-checking and hyphenation match. */
export function setLocale(locale: Locale) {
  if (useI18nStore.getState().locale !== locale) useI18nStore.setState({ locale });
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

const table = namespaces as unknown as Record<string, Record<Locale, Messages>>;

/** Looks a key up in `locale`, falling back to English, then to the key itself. */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const dot = key.indexOf(".");
  const namespace = table[key.slice(0, dot)];
  const name = key.slice(dot + 1);
  const entry: Message | undefined = namespace?.[locale][name] ?? namespace?.en[name];
  if (entry === undefined) {
    if (import.meta.env.DEV) console.warn(`i18n: missing message "${key}"`);
    return key;
  }
  return formatMessage(entry, locale, params);
}

/** Translates `key` in the current locale. For code outside React (stores, registries). */
export function t(key: MessageKey, params?: Params): string {
  return translate(getLocale(), key, params);
}

/** Same as {@link t}, but the component re-renders when the language changes. */
export function useT(): typeof t {
  useI18nStore((s) => s.locale);
  return t;
}

export function useLocale(): Locale {
  return useI18nStore((s) => s.locale);
}

/** Re-resolves "system" when the OS language changes while the app is open. */
export function watchSystemLanguage(getSetting: () => Language): () => void {
  const handler = () => {
    if (getSetting() === "system") setLocale(resolveLocale("system"));
  };
  window.addEventListener("languagechange", handler);
  return () => {
    window.removeEventListener("languagechange", handler);
  };
}
