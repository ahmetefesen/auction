"use client";

import { useCallback } from "react";
import { formatApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

/** Locale-aware API error formatting for client components. */
export function useFormatApiError(): (err: unknown) => string {
  const { locale } = useLocale();
  return useCallback((err: unknown) => formatApiError(err, locale), [locale]);
}
