// Owlmetry stores all revenue in USD cents (`app_users.total_revenue_usd_cents`).
// RevenueCat normalizes to USD on every transaction; if a non-USD reporting
// surface ever lands, add a `revenue_currency` column rather than reusing
// these helpers — they're explicitly USD-only.
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const usdCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  return usdFormatter.format(amount);
}

/** Compact form (e.g. "$12.5K") for tight layouts and big numbers. */
export function formatUsdCompact(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  if (Math.abs(amount) < 1000) return usdFormatter.format(amount);
  return usdCompactFormatter.format(amount);
}
