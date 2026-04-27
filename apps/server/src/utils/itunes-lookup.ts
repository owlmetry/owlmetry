// Shared iTunes Lookup client used by both app_version_sync (single US lookup
// for `latest_app_version` + `apple_app_store_id`) and app_store_ratings_sync
// (per-storefront fan-out for ratings). The endpoint is public + unauthed; we
// just timeout aggressively and return a discriminated result.

const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const ITUNES_TIMEOUT_MS = 10_000;

export interface ItunesResult {
  trackId?: number;
  version?: string;
  bundleId?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  averageUserRatingForCurrentVersion?: number;
  userRatingCountForCurrentVersion?: number;
}

interface ItunesLookupResponse {
  resultCount: number;
  results: ItunesResult[];
}

export type ItunesLookupOutcome =
  | { kind: "found"; result: ItunesResult }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export async function lookupItunes(bundleId: string, country: string): Promise<ItunesLookupOutcome> {
  try {
    const url = `${ITUNES_LOOKUP_URL}?bundleId=${encodeURIComponent(bundleId)}&country=${country}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS) });
    // iTunes 404s for storefronts where the app isn't sold — that's a normal
    // "not in this region" signal, not an error. Treat any other non-200 as
    // a real error (rate-limit, server-side issue, etc).
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "error", message: `HTTP ${res.status}` };
    const data = (await res.json()) as ItunesLookupResponse;
    const result = data.results?.[0];
    if (!result) return { kind: "not_found" };
    return { kind: "found", result };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
