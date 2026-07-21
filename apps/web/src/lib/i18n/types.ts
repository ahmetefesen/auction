export const LOCALES = ["en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "lotforge_locale";
export const LOCALE_STORAGE_KEY = "lotforge_locale";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "tr";
}

export function localeToBcp47(locale: Locale): string {
  return locale === "tr" ? "tr-TR" : "en-US";
}
