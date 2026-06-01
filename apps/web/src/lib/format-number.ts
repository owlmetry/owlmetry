/**
 * Format a count for the compact dashboard stat tiles.
 *
 * - Below 100,000: locale thousands separators (`11832` → `11,832`) so smaller
 *   numbers stay exact and readable.
 * - 100,000 and up: abbreviate to a short suffixed form (`408885` → `409k`,
 *   `1_250_000` → `1.3M`) so the headline numbers can't overflow the tile.
 *
 * The 100k threshold matches the point where un-separated numbers start to get
 * long; a value like `99,999` still renders in full, `100k` and beyond compress.
 */
export function formatStatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);

  const abs = Math.abs(value);

  // Roll up to the next unit once rounding would otherwise print e.g. "1000k".
  if (abs >= 999_500_000_000) return `${trimUnit(value / 1_000_000_000_000)}T`;
  if (abs >= 999_500_000) return `${trimUnit(value / 1_000_000_000)}B`;
  if (abs >= 999_500) return `${trimUnit(value / 1_000_000)}M`;
  if (abs >= 100_000) return `${Math.round(value / 1_000)}k`;

  return value.toLocaleString();
}

/** One-decimal below 10× the unit (`1.3M`), whole numbers above (`12M`); drops a trailing `.0`. */
function trimUnit(scaled: number): string {
  const fixed = Math.abs(scaled) < 10 ? scaled.toFixed(1) : Math.round(scaled).toString();
  return fixed.replace(/\.0$/, "");
}
