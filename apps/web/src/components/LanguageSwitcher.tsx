"use client";

import { useLocale, type Locale } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  function select(next: Locale): void {
    if (next === locale) return;
    setLocale(next);
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded border border-white/15 p-0.5 text-xs"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => select("en")}
        className={`px-2 py-1 ${
          locale === "en" ? "bg-brass-500/20 text-brass-400" : "text-mist-300 hover:text-mist-50"
        }`}
        aria-pressed={locale === "en"}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => select("tr")}
        className={`px-2 py-1 ${
          locale === "tr" ? "bg-brass-500/20 text-brass-400" : "text-mist-300 hover:text-mist-50"
        }`}
        aria-pressed={locale === "tr"}
      >
        TR
      </button>
    </div>
  );
}
