/**
 * Minimal, dependency-free i18n: typed message keys, `{name}` interpolation and CLDR plural
 * forms via `Intl.PluralRules`. Messages live in `./messages/<namespace>.ts`; every namespace
 * carries its English source and a Russian translation checked by the type system.
 */

import type { Language } from "@/lib/bindings";

export type Locale = "en" | "ru";

export const LOCALES: readonly Locale[] = ["en", "ru"];
export const DEFAULT_LOCALE: Locale = "en";

/** Native names, shown as-is in every UI language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ru: "Русский" };

/** One message per CLDR plural category; `other` is the fallback and always required. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | PluralForms;
export type Messages = Record<string, Message>;

/** A translation must cover every key and keep each entry's shape (plain string or plural). */
export type Translation<M extends Messages> = {
  [K in keyof M]: M[K] extends string ? string : PluralForms;
};

export interface Namespace<M extends Messages = Messages> {
  en: M;
  ru: Translation<M>;
}

/** Identity helper that ties the Russian translation to the English keys at compile time. */
export function defineMessages<M extends Messages>(namespace: Namespace<M>): Namespace<M> {
  return namespace;
}

/** Interpolation values; `count` also selects the plural form. */
export type Params = Record<string, string | number>;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

export function selectForm(forms: PluralForms, locale: Locale, count: number | undefined): string {
  if (count === undefined) return forms.other;
  return forms[pluralCategory(locale, count)] ?? forms.other;
}

/** Replaces `{name}` with `params.name`; unknown placeholders are left untouched. */
export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

export function formatMessage(entry: Message, locale: Locale, params?: Params): string {
  const count = params?.count;
  const text =
    typeof entry === "string"
      ? entry
      : selectForm(entry, locale, typeof count === "number" ? count : undefined);
  return interpolate(text, params);
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  // `languages` can be empty in some webviews; `language` is always set.
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}

/**
 * Picks the UI locale: an explicit setting wins; "system" takes the first browser language
 * we have a translation for and falls back to English.
 */
export function resolveLocale(
  setting: Language,
  languages: readonly string[] = browserLanguages(),
): Locale {
  if (setting !== "system") return setting;
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0] ?? "";
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
