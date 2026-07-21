import type { Locale } from "../types";
import { en, type Dictionary } from "./en";
import { tr } from "./tr";

const dictionaries: Record<Locale, Dictionary> = { en, tr };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? en;
}

export type { Dictionary };
export { en, tr };
