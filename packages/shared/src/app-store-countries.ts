// Apple App Store storefronts. Lower-case ISO-3166 country codes that the iTunes
// public RSS reviews feed accepts as the {country} path segment. List sourced from
// Apple's storefront roster — kept in sync with the iTunes Lookup `country=` accepted
// values. Matches the storefront codes used at https://itunes.apple.com/{country}/rss/...
//
// Used by the `app_reviews_sync` job (iterates over every storefront per app) and by
// the dashboard country filter (resolves codes to display names).

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

export const COUNTRY_NAMES: Record<string, string> = {
  ai: "Anguilla", ag: "Antigua & Barbuda", ar: "Argentina", am: "Armenia",
  au: "Australia", at: "Austria", az: "Azerbaijan", bs: "Bahamas", bh: "Bahrain",
  bb: "Barbados", by: "Belarus", be: "Belgium", bz: "Belize", bj: "Benin",
  bm: "Bermuda", bt: "Bhutan", bo: "Bolivia", ba: "Bosnia & Herzegovina",
  bw: "Botswana", br: "Brazil", vg: "British Virgin Islands", bn: "Brunei",
  bg: "Bulgaria", bf: "Burkina Faso", kh: "Cambodia", ca: "Canada",
  cv: "Cape Verde", ky: "Cayman Islands", td: "Chad", cl: "Chile", cn: "China",
  co: "Colombia", cr: "Costa Rica", ci: "Côte d'Ivoire", hr: "Croatia",
  cy: "Cyprus", cz: "Czech Republic", cd: "DR Congo", dk: "Denmark",
  dm: "Dominica", do: "Dominican Republic", ec: "Ecuador", eg: "Egypt",
  sv: "El Salvador", ee: "Estonia", sz: "Eswatini", fj: "Fiji", fi: "Finland",
  fr: "France", gm: "Gambia", ga: "Gabon", ge: "Georgia", de: "Germany",
  gh: "Ghana", gr: "Greece", gd: "Grenada", gt: "Guatemala", gw: "Guinea-Bissau",
  gy: "Guyana", hn: "Honduras", hk: "Hong Kong", hu: "Hungary", is: "Iceland",
  in: "India", id: "Indonesia", iq: "Iraq", ie: "Ireland", il: "Israel",
  it: "Italy", jm: "Jamaica", jp: "Japan", jo: "Jordan", kz: "Kazakhstan",
  ke: "Kenya", kr: "South Korea", xk: "Kosovo", kw: "Kuwait", kg: "Kyrgyzstan",
  la: "Laos", lv: "Latvia", lb: "Lebanon", lr: "Liberia", ly: "Libya",
  lt: "Lithuania", lu: "Luxembourg", mo: "Macao", mg: "Madagascar", mw: "Malawi",
  my: "Malaysia", mv: "Maldives", ml: "Mali", mt: "Malta", mr: "Mauritania",
  mu: "Mauritius", mx: "Mexico", fm: "Micronesia", md: "Moldova", mn: "Mongolia",
  me: "Montenegro", ms: "Montserrat", ma: "Morocco", mz: "Mozambique",
  mm: "Myanmar", na: "Namibia", np: "Nepal", nl: "Netherlands", nz: "New Zealand",
  ni: "Nicaragua", ne: "Niger", ng: "Nigeria", mk: "North Macedonia", no: "Norway",
  om: "Oman", pk: "Pakistan", pw: "Palau", pa: "Panama", pg: "Papua New Guinea",
  py: "Paraguay", pe: "Peru", ph: "Philippines", pl: "Poland", pt: "Portugal",
  qa: "Qatar", cg: "Republic of Congo", ro: "Romania", ru: "Russia", rw: "Rwanda",
  sa: "Saudi Arabia", sn: "Senegal", rs: "Serbia", sc: "Seychelles",
  sl: "Sierra Leone", sg: "Singapore", sk: "Slovakia", si: "Slovenia",
  sb: "Solomon Islands", za: "South Africa", es: "Spain", lk: "Sri Lanka",
  kn: "St. Kitts & Nevis", lc: "St. Lucia", vc: "St. Vincent & The Grenadines",
  sr: "Suriname", se: "Sweden", ch: "Switzerland", tw: "Taiwan", tj: "Tajikistan",
  tz: "Tanzania", th: "Thailand", tt: "Trinidad & Tobago", tn: "Tunisia",
  tr: "Türkiye", tm: "Turkmenistan", tc: "Turks & Caicos", ug: "Uganda",
  ua: "Ukraine", ae: "United Arab Emirates", gb: "United Kingdom",
  us: "United States", uy: "Uruguay", uz: "Uzbekistan", vu: "Vanuatu",
  ve: "Venezuela", vn: "Vietnam", ye: "Yemen", zm: "Zambia", zw: "Zimbabwe",
};

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return COUNTRY_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

// Regional indicator emoji flag (e.g. "us" → "🇺🇸"). Returns empty string for invalid codes.
export function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const lower = code.toLowerCase();
  if (!/^[a-z]{2}$/.test(lower)) return "";
  const base = 0x1f1e6;
  const a = "a".charCodeAt(0);
  return String.fromCodePoint(
    base + lower.charCodeAt(0) - a,
    base + lower.charCodeAt(1) - a,
  );
}
