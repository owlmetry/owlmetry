const REGIONAL_INDICATOR_BASE = 0x1f1e6;
const ASCII_A = 65;

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

const languageNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;

/** Human-readable name for a BCP-47 language tag, e.g. "fr-CA" → "French (Canada)". */
export function languageName(tag: string): string {
  try {
    return languageNames?.of(tag.replace(/_/g, "-")) ?? tag;
  } catch {
    return tag;
  }
}

export interface CountryFlag {
  emoji: string;
  code: string;
  name: string;
}

const PLACEHOLDER: CountryFlag = { emoji: "", code: "—", name: "Unknown" };

const cache = new Map<string, CountryFlag>();

export function countryFlag(code: string | null | undefined): CountryFlag {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return PLACEHOLDER;
  const upper = code.toUpperCase();
  const cached = cache.get(upper);
  if (cached) return cached;

  const emoji = String.fromCodePoint(
    ...[...upper].map((c) => REGIONAL_INDICATOR_BASE + c.charCodeAt(0) - ASCII_A),
  );
  const name = regionNames?.of(upper) ?? upper;
  const result: CountryFlag = { emoji, code: upper, name };
  cache.set(upper, result);
  return result;
}
