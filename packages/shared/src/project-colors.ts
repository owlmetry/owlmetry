// Canonical palette used by the server to auto-assign a color when a project
// is created, and by the web dashboard to offer swatch presets in the color
// picker. Stored as `#RRGGBB` hex strings.
//
// NOTE: the initial backfill migration (see packages/db/drizzle) embeds a
// snapshot of this list. That is a deliberate one-time duplication — the
// migration represents a point in time and should not change if this palette
// is later edited.
export const PROJECT_COLORS: readonly string[] = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#64748b", "#c2410c", "#15803d",
];

export const PROJECT_COLOR_FALLBACK = "#64748b";

export function isValidProjectColor(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}
