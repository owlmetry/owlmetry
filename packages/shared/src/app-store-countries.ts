// Apple App Store storefronts. Lower-case ISO-3166 country codes that the iTunes
// public RSS reviews feed accepts as the {country} path segment. Matches the
// storefront codes used at https://itunes.apple.com/{country}/rss/...
//
// Used by the `app_reviews_sync` job (iterates over every storefront per app) and
// by the dashboard country filter helpers below.

export const APPLE_APP_STORE_COUNTRIES: readonly string[] = [
  "ai", "ag", "ar", "am", "au", "at", "az", "bs", "bh", "bb", "by", "be", "bz",
  "bj", "bm", "bt", "bo", "ba", "bw", "br", "vg", "bn", "bg", "bf", "kh", "ca",
  "cv", "ky", "td", "cl", "cn", "co", "cr", "ci", "hr", "cy", "cz", "cd", "dk",
  "dm", "do", "ec", "eg", "sv", "ee", "sz", "fj", "fi", "fr", "gm", "ga", "ge",
  "de", "gh", "gr", "gd", "gt", "gw", "gy", "hn", "hk", "hu", "is", "in", "id",
  "iq", "ie", "il", "it", "jm", "jp", "jo", "kz", "ke", "kr", "xk", "kw", "kg",
  "la", "lv", "lb", "lr", "ly", "lt", "lu", "mo", "mg", "mw", "my", "mv", "ml",
  "mt", "mr", "mu", "mx", "fm", "md", "mn", "me", "ms", "ma", "mz", "mm", "na",
  "np", "nl", "nz", "ni", "ne", "ng", "mk", "no", "om", "pk", "pw", "pa", "pg",
  "py", "pe", "ph", "pl", "pt", "qa", "cg", "ro", "ru", "rw", "sa", "sn", "rs",
  "sc", "sl", "sg", "sk", "si", "sb", "za", "es", "lk", "kn", "lc", "vc", "sr",
  "se", "ch", "tw", "tj", "tz", "th", "tt", "tn", "tr", "tm", "tc", "ug", "ua",
  "ae", "gb", "us", "uy", "uz", "vu", "ve", "vn", "ye", "zm", "zw",
] as const;

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  const upper = code.toUpperCase();
  return regionNames?.of(upper) ?? upper;
}

// Regional-indicator emoji flag (e.g. "us" → "🇺🇸"). Returns empty string for
// invalid codes.
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  const upper = code.toUpperCase();
  const base = 0x1f1e6;
  const a = "A".charCodeAt(0);
  return String.fromCodePoint(
    base + upper.charCodeAt(0) - a,
    base + upper.charCodeAt(1) - a,
  );
}
