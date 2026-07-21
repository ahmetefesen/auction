"use client";

import { useLocale, localeToBcp47 } from "@/lib/i18n";

type MoneyInputProps = {
  id?: string;
  label?: string;
  valueCents: number | null;
  onChangeCents: (cents: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

/** Display major units (TRY), emit integer kuruş/cents to the API. */
export function MoneyInput({
  id,
  label,
  valueCents,
  onChangeCents,
  disabled,
  placeholder,
  className = "",
}: MoneyInputProps) {
  const { locale } = useLocale();
  const bcp47 = localeToBcp47(locale);
  const defaultPlaceholder = locale === "tr" ? "0,00" : "0.00";

  const display =
    valueCents == null
      ? ""
      : (valueCents / 100).toLocaleString(bcp47, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });

  function handleChange(raw: string): void {
    const trimmed = raw.trim().replace(/\s/g, "");
    if (!trimmed) {
      onChangeCents(null);
      return;
    }
    const normalized =
      locale === "tr"
        ? trimmed.replace(/\./g, "").replace(",", ".")
        : trimmed.replace(/,/g, "");
    const major = Number.parseFloat(normalized);
    if (!Number.isFinite(major) || major < 0) {
      onChangeCents(null);
      return;
    }
    onChangeCents(Math.round(major * 100));
  }

  return (
    <label className={`block text-sm text-mist-300 ${className}`}>
      {label ? <span>{label}</span> : null}
      <div className={`relative ${label ? "mt-1" : ""}`}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className="w-full border border-white/15 bg-ink-950 px-3 py-2 pr-10 text-mist-50 outline-none focus:border-brass-500 disabled:opacity-60"
          value={display}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder ?? defaultPlaceholder}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mist-300">
          ₺
        </span>
      </div>
    </label>
  );
}
