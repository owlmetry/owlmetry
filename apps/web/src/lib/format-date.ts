/**
 * Locale-aware date formatting utilities.
 *
 * Detects the user's region from their browser languages and timezone,
 * so dates format correctly even when navigator.language is "en-US" but
 * the user is physically elsewhere.
 *
 * Detection strategy:
 * 1. Check navigator.languages for a non-primary language with a region
 *    (e.g. "af" → maximize → "af-Latn-ZA" → region ZA)
 * 2. Fall back to timezone continent — anything outside America/* is
 *    unlikely to want US-style mm/dd/yyyy
 * 3. Fall back to navigator.language (browser default)
 */

// ---------------------------------------------------------------------------
// Locale detection (cached)
// ---------------------------------------------------------------------------
let _locale: string | undefined;

/**
 * Detect the user's locale from browser signals.
 *
 * Returns a BCP 47 locale string like "en-ZA" or undefined to use the
 * browser default.
 */
function getLocale(): string | undefined {
  if (_locale !== undefined) return _locale || undefined;

  if (typeof window === "undefined") {
    _locale = "";
    return undefined;
  }

  try {
    const primary = navigator.language;
    const primaryLang = primary.split("-")[0];

    // 1. Look for a secondary language that implies a different region.
    //    e.g. ["en-US", "en", "af"] — "af" maximizes to "af-Latn-ZA" → ZA
    for (let i = 1; i < navigator.languages.length; i++) {
      try {
        const loc = new Intl.Locale(navigator.languages[i]).maximize();
        if (loc.region && loc.region !== "US") {
          _locale = `${primaryLang}-${loc.region}`;
          return _locale;
        }
      } catch { /* skip invalid locales */ }
    }

    // 2. Use timezone continent as a heuristic.
    //    Only America/* timezones commonly use mm/dd/yyyy; everywhere else
    //    the US format is unexpected.
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    if (timeZone && !timeZone.startsWith("America/") && !timeZone.startsWith("US/")) {
      // Map continent to a sensible English locale for date ordering
      const continent = timeZone.split("/")[0];
      const CONTINENT_LOCALE: Record<string, string> = {
        Europe: "GB", Africa: "GB", Asia: "GB", Australia: "AU",
        Pacific: "NZ", Indian: "GB", Atlantic: "GB", Antarctica: "GB",
      };
      const region = CONTINENT_LOCALE[continent];
      if (region) {
        _locale = `${primaryLang}-${region}`;
        return _locale;
      }
    }

    // 3. Browser default
    _locale = "";
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
