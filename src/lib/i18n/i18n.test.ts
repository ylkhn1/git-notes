import { beforeEach, describe, expect, it } from "vitest";

import {
  formatMessage,
  interpolate,
  type Messages,
  type PluralForms,
  resolveLocale,
  selectForm,
} from "./core";
import { getLocale, setLocale, t, translate } from "./index";
import { namespaces } from "./messages";

describe("interpolate", () => {
  it("replaces named placeholders and keeps unknown ones", () => {
    expect(interpolate("{count} of {total} — {missing}", { count: 2, total: 5 })).toBe(
      "2 of 5 — {missing}",
    );
    expect(interpolate("plain")).toBe("plain");
  });
});

describe("plural forms", () => {
  const ru: PluralForms = {
    one: "{count} день",
    few: "{count} дня",
    many: "{count} дней",
    other: "{count} дня",
  };
  const en: PluralForms = { one: "{count} day", other: "{count} days" };

  it("follows CLDR categories per locale", () => {
    expect(formatMessage(ru, "ru", { count: 1 })).toBe("1 день");
    expect(formatMessage(ru, "ru", { count: 3 })).toBe("3 дня");
    expect(formatMessage(ru, "ru", { count: 5 })).toBe("5 дней");
    expect(formatMessage(ru, "ru", { count: 21 })).toBe("21 день");
    expect(formatMessage(ru, "ru", { count: 12 })).toBe("12 дней");
    expect(formatMessage(en, "en", { count: 1 })).toBe("1 day");
    expect(formatMessage(en, "en", { count: 0 })).toBe("0 days");
  });

  it("uses `other` without a count or for a missing category", () => {
    expect(selectForm(en, "en", undefined)).toBe("{count} days");
    expect(selectForm({ other: "x" }, "ru", 1)).toBe("x");
  });
});

describe("resolveLocale", () => {
  it("prefers an explicit setting", () => {
    expect(resolveLocale("ru", ["en-US"])).toBe("ru");
    expect(resolveLocale("en", ["ru-RU"])).toBe("en");
  });

  it("takes the first supported browser language for system", () => {
    expect(resolveLocale("system", ["de-DE", "ru-RU", "en"])).toBe("ru");
    expect(resolveLocale("system", ["RU"])).toBe("ru");
    expect(resolveLocale("system", ["de", "fr"])).toBe("en");
    expect(resolveLocale("system", [])).toBe("en");
  });
});

describe("t", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("translates in the current locale and updates <html lang>", () => {
    expect(t("common.cancel")).toBe("Cancel");
    setLocale("ru");
    expect(getLocale()).toBe("ru");
    expect(t("common.cancel")).toBe("Отмена");
    expect(document.documentElement.lang).toBe("ru");
  });

  it("selects plural forms by count", () => {
    expect(translate("en", "time.daysAgo", { count: 1 })).toBe("1 day ago");
    expect(translate("en", "time.daysAgo", { count: 4 })).toBe("4 days ago");
    expect(translate("ru", "time.daysAgo", { count: 4 })).toBe("4 дня назад");
    expect(translate("ru", "time.daysAgo", { count: 11 })).toBe("11 дней назад");
  });

  it("returns the key for unknown messages", () => {
    // @ts-expect-error — deliberately not a MessageKey
    expect(translate("en", "nope.missing")).toBe("nope.missing");
  });
});

describe("message catalogues", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
  const forms = (entry: Messages[string]) =>
    typeof entry === "string" ? [entry] : Object.values(entry);

  it("translate every English key with the same placeholders", () => {
    for (const [name, namespace] of Object.entries(namespaces)) {
      const en = namespace.en as Messages;
      const ru = namespace.ru as Messages;
      expect(Object.keys(ru).sort(), `keys of ${name}`).toEqual(Object.keys(en).sort());
      for (const [key, entry] of Object.entries(en)) {
        const translated = ru[key];
        expect(translated, `${name}.${key}`).toBeDefined();
        if (!translated) continue;
        expect(typeof translated, `${name}.${key} shape`).toBe(typeof entry);
        const expected = placeholders(forms(entry).join(" "));
        for (const text of forms(translated)) {
          expect(text.trim(), `${name}.${key} is empty`).not.toBe("");
          for (const p of placeholders(text))
            expect(expected, `${name}.${key} placeholder {${p}}`).toContain(p);
        }
        if (typeof translated !== "string") {
          expect(translated.other, `${name}.${key} needs other`).toBeDefined();
        }
      }
    }
  });
});
