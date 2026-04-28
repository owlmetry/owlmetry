import type { AppResponse } from "@owlmetry/shared";

// Weighted-average rating + total + delta across a set of apps. Used by the
// main dashboard "Avg Rating" card and the Reviews-page Ratings panel hero +
// per-project rows. Each app's worldwide cache is itself a daily weighted
// aggregate; weighting again here by per-app rating count prevents a 5★ app
// with 1 rating from outweighing a 4★ app with 50,000.
//
// Returns null when no app has any rating data. `delta` is null when no app
// has a previous-snapshot baseline (first-day data).
export function computeRatingSummary(
  apps: AppResponse[],
): { avg: number; total: number; delta: number | null } | null {
  let weighted = 0;
  let total = 0;
  let delta = 0;
  let hasDelta = false;
  for (const a of apps) {
    const r = a.worldwide_average_rating;
    const c = a.worldwide_rating_count ?? 0;
    if (r === null || r === undefined || c <= 0) continue;
    weighted += r * c;
    total += c;
    if (a.worldwide_rating_count_delta != null) {
      delta += a.worldwide_rating_count_delta;
      hasDelta = true;
    }
  }
  if (total === 0) return null;
  return { avg: weighted / total, total, delta: hasDelta ? delta : null };
}
