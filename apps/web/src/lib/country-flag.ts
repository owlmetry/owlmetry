const REGIONAL_INDICATOR_BASE = 0x1f1e6;
const ASCII_A = 65;

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export interface CountryFlag {
  emoji: string;
  code: string;
  name: string;
}

const PLACEHOLDER: CountryFlag = { emoji: "", code: "—", name: "Unknown" };

export function countryFlag(code: string | null | undefined): CountryFlag {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return PLACEHOLDER;
  const upper = code.toUpperCase();
  const emoji = String.fromCodePoint(
    ...[...upper].map((c) => REGIONAL_INDICATOR_BASE + c.charCodeAt(0) - ASCII_A),
  );
  let name = upper;
  try {
    name = regionNames?.of(upper) ?? upper;
  } catch {
    name = upper;
  }
  return { emoji, code: upper, name };
}
