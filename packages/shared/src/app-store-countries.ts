// Country/territory display + code-conversion helpers used by the reviews
// dashboard and the App Store Connect reviews sync (which gets territories from
// Apple as ISO 3166-1 alpha-3 codes like "USA" / "GBR" and stores them as
// alpha-2 in `app_store_reviews.country_code`).

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

// ISO 3166-1 alpha-3 → alpha-2 lookup. Covers every territory App Store Connect
// returns on customerReviews. Apple uses "GBR" / "USA" / "DEU" etc.; our
// `app_store_reviews.country_code` column is varchar(2), so we normalize at
// ingest. Unknown / unmappable codes return null (the column is nullable).
const ISO3_TO_ISO2: Record<string, string> = {
  AFG: "af", ALA: "ax", ALB: "al", DZA: "dz", ASM: "as", AND: "ad", AGO: "ao",
  AIA: "ai", ATG: "ag", ARG: "ar", ARM: "am", ABW: "aw", AUS: "au", AUT: "at",
  AZE: "az", BHS: "bs", BHR: "bh", BGD: "bd", BRB: "bb", BLR: "by", BEL: "be",
  BLZ: "bz", BEN: "bj", BMU: "bm", BTN: "bt", BOL: "bo", BES: "bq", BIH: "ba",
  BWA: "bw", BVT: "bv", BRA: "br", IOT: "io", BRN: "bn", BGR: "bg", BFA: "bf",
  BDI: "bi", CPV: "cv", KHM: "kh", CMR: "cm", CAN: "ca", CYM: "ky", CAF: "cf",
  TCD: "td", CHL: "cl", CHN: "cn", CXR: "cx", CCK: "cc", COL: "co", COM: "km",
  COG: "cg", COD: "cd", COK: "ck", CRI: "cr", CIV: "ci", HRV: "hr", CUB: "cu",
  CUW: "cw", CYP: "cy", CZE: "cz", DNK: "dk", DJI: "dj", DMA: "dm", DOM: "do",
  ECU: "ec", EGY: "eg", SLV: "sv", GNQ: "gq", ERI: "er", EST: "ee", SWZ: "sz",
  ETH: "et", FLK: "fk", FRO: "fo", FJI: "fj", FIN: "fi", FRA: "fr", GUF: "gf",
  PYF: "pf", ATF: "tf", GAB: "ga", GMB: "gm", GEO: "ge", DEU: "de", GHA: "gh",
  GIB: "gi", GRC: "gr", GRL: "gl", GRD: "gd", GLP: "gp", GUM: "gu", GTM: "gt",
  GGY: "gg", GIN: "gn", GNB: "gw", GUY: "gy", HTI: "ht", HMD: "hm", VAT: "va",
  HND: "hn", HKG: "hk", HUN: "hu", ISL: "is", IND: "in", IDN: "id", IRN: "ir",
  IRQ: "iq", IRL: "ie", IMN: "im", ISR: "il", ITA: "it", JAM: "jm", JPN: "jp",
  JEY: "je", JOR: "jo", KAZ: "kz", KEN: "ke", KIR: "ki", PRK: "kp", KOR: "kr",
  KWT: "kw", KGZ: "kg", LAO: "la", LVA: "lv", LBN: "lb", LSO: "ls", LBR: "lr",
  LBY: "ly", LIE: "li", LTU: "lt", LUX: "lu", MAC: "mo", MKD: "mk", MDG: "mg",
  MWI: "mw", MYS: "my", MDV: "mv", MLI: "ml", MLT: "mt", MHL: "mh", MTQ: "mq",
  MRT: "mr", MUS: "mu", MYT: "yt", MEX: "mx", FSM: "fm", MDA: "md", MCO: "mc",
  MNG: "mn", MNE: "me", MSR: "ms", MAR: "ma", MOZ: "mz", MMR: "mm", NAM: "na",
  NRU: "nr", NPL: "np", NLD: "nl", NCL: "nc", NZL: "nz", NIC: "ni", NER: "ne",
  NGA: "ng", NIU: "nu", NFK: "nf", MNP: "mp", NOR: "no", OMN: "om", PAK: "pk",
  PLW: "pw", PSE: "ps", PAN: "pa", PNG: "pg", PRY: "py", PER: "pe", PHL: "ph",
  PCN: "pn", POL: "pl", PRT: "pt", PRI: "pr", QAT: "qa", REU: "re", ROU: "ro",
  RUS: "ru", RWA: "rw", BLM: "bl", SHN: "sh", KNA: "kn", LCA: "lc", MAF: "mf",
  SPM: "pm", VCT: "vc", WSM: "ws", SMR: "sm", STP: "st", SAU: "sa", SEN: "sn",
  SRB: "rs", SYC: "sc", SLE: "sl", SGP: "sg", SXM: "sx", SVK: "sk", SVN: "si",
  SLB: "sb", SOM: "so", ZAF: "za", SGS: "gs", SSD: "ss", ESP: "es", LKA: "lk",
  SDN: "sd", SUR: "sr", SJM: "sj", SWE: "se", CHE: "ch", SYR: "sy", TWN: "tw",
  TJK: "tj", TZA: "tz", THA: "th", TLS: "tl", TGO: "tg", TKL: "tk", TON: "to",
  TTO: "tt", TUN: "tn", TUR: "tr", TKM: "tm", TCA: "tc", TUV: "tv", UGA: "ug",
  UKR: "ua", ARE: "ae", GBR: "gb", USA: "us", UMI: "um", URY: "uy", UZB: "uz",
  VUT: "vu", VEN: "ve", VNM: "vn", VGB: "vg", VIR: "vi", WLF: "wf", ESH: "eh",
  YEM: "ye", ZMB: "zm", ZWE: "zw", XKX: "xk",
};

export function iso3ToIso2(code: string | null | undefined): string | null {
  if (!code) return null;
  return ISO3_TO_ISO2[code.toUpperCase()] ?? null;
}

// All Apple iTunes Lookup storefront codes (ISO 3166-1 alpha-2). Derived from the
// ISO3 → ISO2 mapping above so the two stay in lockstep. Apple silently returns
// `resultCount: 0` for storefronts where the app isn't sold, so it's cheap to
// fan out across the full set in the daily ratings sync. Set-wrapped to dedupe
// any ISO3 codes that share an ISO2 (none today, defensive for future rows).
const APPLE_STOREFRONT_CODE_SET = new Set<string>(Object.values(ISO3_TO_ISO2));
export const APPLE_STOREFRONT_CODES: readonly string[] = Object.freeze(
  [...APPLE_STOREFRONT_CODE_SET].sort(),
);

export function isAppleStorefront(code: string | null | undefined): boolean {
  if (!code) return false;
  return APPLE_STOREFRONT_CODE_SET.has(code.toLowerCase());
}
