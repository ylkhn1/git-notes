import { defineMessages } from "../core";

/** Relative times and short durations (`lib/time.ts`, sync countdowns). */
export default defineMessages({
  en: {
    justNow: "just now",
    minutesAgo: "{count} min ago",
    hoursAgo: "{count} h ago",
    yesterday: "yesterday",
    daysAgo: { one: "{count} day ago", other: "{count} days ago" },
    seconds: "{count} s",
    minutes: "{count} min",
    hours: "{count} h",
  },
  ru: {
    justNow: "только что",
    minutesAgo: "{count} мин назад",
    hoursAgo: "{count} ч назад",
    yesterday: "вчера",
    daysAgo: {
      one: "{count} день назад",
      few: "{count} дня назад",
      many: "{count} дней назад",
      other: "{count} дня назад",
    },
    seconds: "{count} с",
    minutes: "{count} мин",
    hours: "{count} ч",
  },
});
