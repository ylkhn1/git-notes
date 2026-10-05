import { getLocale, t } from "@/lib/i18n";

/** "512 B", "48 KB", "3.2 MB" — for download progress and sizes, in the UI language. */
export function formatBytes(bytes: number): string {
  const locale = getLocale();
  if (bytes < 1024) return t("common.bytes", { count: bytes });
  if (bytes < 1024 * 1024) {
    return t("common.kilobytes", { count: Math.round(bytes / 1024).toLocaleString(locale) });
  }
  const mb = (bytes / (1024 * 1024)).toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return t("common.megabytes", { count: mb });
}
