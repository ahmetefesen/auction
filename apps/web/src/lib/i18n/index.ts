export type { Locale } from "./types";
export type { Dictionary } from "./dictionaries/en";
export { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, isLocale, localeToBcp47 } from "./types";
export { getDictionary } from "./dictionaries";
export { LocaleProvider, useLocale, useT } from "./locale-context";
