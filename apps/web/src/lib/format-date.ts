/**
 * Locale-aware date formatting utilities.
 *
 * Detects the user's region from their timezone (not just browser language)
 * so dates format correctly even when navigator.language is "en-US" but the
 * user is physically elsewhere. For example, a user in South Africa with an
 * en-US browser sees dd/mm/yyyy instead of mm/dd/yyyy.
 */

// ---------------------------------------------------------------------------
// Timezone → ISO 3166-1 region code mapping
// ---------------------------------------------------------------------------
const TZ_TO_REGION: Record<string, string> = {
  // Africa
  "Africa/Abidjan": "CI", "Africa/Accra": "GH", "Africa/Addis_Ababa": "ET",
  "Africa/Algiers": "DZ", "Africa/Cairo": "EG", "Africa/Casablanca": "MA",
  "Africa/Dar_es_Salaam": "TZ", "Africa/Johannesburg": "ZA", "Africa/Kampala": "UG",
  "Africa/Khartoum": "SD", "Africa/Kigali": "RW", "Africa/Lagos": "NG",
  "Africa/Luanda": "AO", "Africa/Maputo": "MZ", "Africa/Nairobi": "KE",
  "Africa/Tunis": "TN", "Africa/Windhoek": "NA",
  // Americas
  "America/Anchorage": "US", "America/Argentina/Buenos_Aires": "AR",
  "America/Bogota": "CO", "America/Caracas": "VE", "America/Chicago": "US",
  "America/Costa_Rica": "CR", "America/Denver": "US", "America/Edmonton": "CA",
  "America/Guatemala": "GT", "America/Halifax": "CA", "America/Havana": "CU",
  "America/Indiana/Indianapolis": "US", "America/Jamaica": "JM",
  "America/Lima": "PE", "America/Los_Angeles": "US", "America/Manaus": "BR",
  "America/Mexico_City": "MX", "America/Monterrey": "MX",
  "America/Montevideo": "UY", "America/New_York": "US", "America/Panama": "PA",
  "America/Phoenix": "US", "America/Puerto_Rico": "PR", "America/Regina": "CA",
  "America/Santiago": "CL", "America/Santo_Domingo": "DO",
  "America/Sao_Paulo": "BR", "America/St_Johns": "CA", "America/Tijuana": "MX",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Winnipeg": "CA",
  // Asia
  "Asia/Almaty": "KZ", "Asia/Amman": "JO", "Asia/Baghdad": "IQ",
  "Asia/Bahrain": "BH", "Asia/Baku": "AZ", "Asia/Bangkok": "TH",
  "Asia/Beirut": "LB", "Asia/Colombo": "LK", "Asia/Damascus": "SY",
  "Asia/Dhaka": "BD", "Asia/Dubai": "AE", "Asia/Ho_Chi_Minh": "VN",
  "Asia/Hong_Kong": "HK", "Asia/Jakarta": "ID", "Asia/Jerusalem": "IL",
  "Asia/Kabul": "AF", "Asia/Karachi": "PK", "Asia/Kathmandu": "NP",
  "Asia/Kolkata": "IN", "Asia/Kuala_Lumpur": "MY", "Asia/Kuwait": "KW",
  "Asia/Macau": "MO", "Asia/Manila": "PH", "Asia/Muscat": "OM",
  "Asia/Nicosia": "CY", "Asia/Qatar": "QA", "Asia/Riyadh": "SA",
  "Asia/Seoul": "KR", "Asia/Shanghai": "CN", "Asia/Singapore": "SG",
  "Asia/Taipei": "TW", "Asia/Tashkent": "UZ", "Asia/Tbilisi": "GE",
  "Asia/Tehran": "IR", "Asia/Tokyo": "JP", "Asia/Urumqi": "CN",
  "Asia/Yangon": "MM", "Asia/Yekaterinburg": "RU", "Asia/Yerevan": "AM",
  // Australia & Pacific
  "Australia/Adelaide": "AU", "Australia/Brisbane": "AU",
  "Australia/Darwin": "AU", "Australia/Hobart": "AU",
  "Australia/Melbourne": "AU", "Australia/Perth": "AU",
  "Australia/Sydney": "AU", "Pacific/Auckland": "NZ",
  "Pacific/Fiji": "FJ", "Pacific/Guam": "GU", "Pacific/Honolulu": "US",
  // Europe
  "Europe/Amsterdam": "NL", "Europe/Athens": "GR", "Europe/Belgrade": "RS",
  "Europe/Berlin": "DE", "Europe/Bratislava": "SK", "Europe/Brussels": "BE",
  "Europe/Bucharest": "RO", "Europe/Budapest": "HU", "Europe/Chisinau": "MD",
  "Europe/Copenhagen": "DK", "Europe/Dublin": "IE", "Europe/Helsinki": "FI",
  "Europe/Istanbul": "TR", "Europe/Kaliningrad": "RU", "Europe/Kyiv": "UA",
  "Europe/Lisbon": "PT", "Europe/Ljubljana": "SI", "Europe/London": "GB",
  "Europe/Madrid": "ES", "Europe/Minsk": "BY", "Europe/Moscow": "RU",
  "Europe/Oslo": "NO", "Europe/Paris": "FR", "Europe/Prague": "CZ",
  "Europe/Riga": "LV", "Europe/Rome": "IT", "Europe/Samara": "RU",
  "Europe/Sofia": "BG", "Europe/Stockholm": "SE", "Europe/Tallinn": "EE",
  "Europe/Vienna": "AT", "Europe/Vilnius": "LT", "Europe/Warsaw": "PL",
  "Europe/Zagreb": "HR", "Europe/Zurich": "CH",
};

// ---------------------------------------------------------------------------
// Locale detection (cached)
// ---------------------------------------------------------------------------
let _locale: string | undefined;

/** Detect the user's locale from their timezone + browser language. */
function getLocale(): string | undefined {
  if (_locale !== undefined) return _locale || undefined;

  if (typeof window === "undefined") {
    // SSR — no detection possible, use browser default
    _locale = "";
    return undefined;
  }

  try {
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    const region = TZ_TO_REGION[timeZone];
    if (region) {
      const lang = navigator.language.split("-")[0];
      _locale = `${lang}-${region}`;
    } else {
      _locale = "";
    }
  } catch {
    _locale = "";
  }

  return _locale || undefined;
}

// ---------------------------------------------------------------------------
// Formatting functions
// ---------------------------------------------------------------------------

/** Short date without year: "Apr 12" / "12 Apr" */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
}

/** Numeric date with year: "4/12/2026" (US) / "12/04/2026" (GB) / "2026/04/12" (ZA) */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getLocale());
}

/** Long date: "Sunday, April 12" */
export function formatLongDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getLocale(), {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Full date with year: "April 12, 2026" / "12 April 2026" */
export function formatFullDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getLocale(), {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Numeric date + time: "4/12/2026, 6:09:17 PM" (US) / "12/04/2026, 18:09:17" (GB) */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(getLocale());
}

/** Compact date + time (no year): "Apr 12, 18:09:17" */
export function formatCompactDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(getLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Time only (24h): "18:09:17" */
export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(getLocale(), { hour12: false });
}
