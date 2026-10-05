/** Human-friendly timestamps for history and sync status, in the UI language. */

import { getLocale, t } from "@/lib/i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else a short date. */
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < MINUTE) return t("time.justNow");
  if (diff < HOUR) return t("time.minutesAgo", { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t("time.hoursAgo", { count: Math.floor(diff / HOUR) });
  const days = Math.floor(diff / DAY);
  if (days === 1) return t("time.yesterday");
  if (days < 7) return t("time.daysAgo", { count: days });
  return new Date(ms).toLocaleDateString(getLocale(), {
    year: days > 300 ? "numeric" : undefined,
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "12 s", "3 min", "2 h" for a duration in milliseconds; never negative. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t("time.seconds", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("time.minutes", { count: minutes });
  return t("time.hours", { count: Math.round(minutes / 60) });
}
