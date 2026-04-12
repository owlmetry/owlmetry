import { formatShortDate } from "@/lib/format-date";

export const ENVIRONMENTS = ["ios", "ipados", "macos", "android", "web", "backend"] as const;

export const TIME_RANGES = [
  { label: "Last hour", value: "1h" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Custom", value: "custom" },
] as const;

const RANGE_MS: Record<string, number> = {
  "1h": 3600_000,
  "24h": 86400_000,
  "7d": 604800_000,
  "30d": 2592000_000,
};

export function sinceFromRange(range: string): string {
  return new Date(Date.now() - (RANGE_MS[range] ?? RANGE_MS["24h"])).toISOString();
}

/** Format a time range value + optional custom dates into a human-readable chip string. */
export function formatTimeRangeChip(value: string, since?: string, until?: string): string {
  if (value === "custom") {
    const fmt = (d: string) => formatShortDate(d);
    if (since && until) return `${fmt(since)} – ${fmt(until)}`;
    if (since) return `Since ${fmt(since)}`;
    if (until) return `Until ${fmt(until)}`;
    return "Custom";
  }
  return TIME_RANGES.find((r) => r.value === value)?.label ?? value;
}
