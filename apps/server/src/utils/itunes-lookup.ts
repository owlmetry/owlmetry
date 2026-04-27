// Shared iTunes Lookup client used by both app_version_sync (single US lookup
// for `latest_app_version` + `apple_app_store_id`) and app_store_ratings_sync
// (per-storefront fan-out for ratings). The endpoint is public + unauthed; we
// just timeout aggressively and return a discriminated result.

const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const ITUNES_TIMEOUT_MS = 10_000;
export const IS_TEST = process.env.NODE_ENV === "test";

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

// Detailed outcome — splits errors by retryability so the per-storefront
// fan-out can apply backoff. 403/429 = Apple-side throttling; 5xx + network
// + timeout are transient. Other non-2xx + parse errors are terminal.
export type ItunesLookupDetailedOutcome =
  | { kind: "found"; result: ItunesResult }
  | { kind: "not_found" }
  | { kind: "rate_limited"; status: number }
  | { kind: "transient"; message: string }
  | { kind: "error"; message: string };

// Adaptive inter-request delay shared by every iTunes Lookup caller in the
// process — concurrent jobs (e.g. cron ratings sync + a manual sync trigger
// + the hourly version sync) all observe the same rate-limit signal so they
// back off together instead of fighting Apple independently from the same IP.
// Steps up fast on 403/429/5xx and decays slowly back toward baseline on
// success — AIMD-style, react fast, recover slow. Test runs use 0ms
// throughout so the suite stays fast.
class AdaptiveThrottler {
  private static readonly BASELINE_MS = IS_TEST ? 0 : 150;
  private static readonly CEILING_MS = IS_TEST ? 0 : 10_000;
  private delayMs = AdaptiveThrottler.BASELINE_MS;
  // Monotonic timestamp for the next allowed request. Each `wait()` claims
  // its slot synchronously (no JS task interleaving between read+write) so
  // concurrent callers serialize through the throttler instead of all
  // sleeping the same delayMs and waking up to fetch in parallel.
  private nextAllowedAt = 0;

  async wait(): Promise<void> {
    if (this.delayMs === 0) return;
    const now = Date.now();
    const slotAt = Math.max(this.nextAllowedAt, now);
    this.nextAllowedAt = slotAt + this.delayMs;
    const sleepMs = slotAt - now;
    if (sleepMs > 0) {
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }

  noteThrottle(): void {
    this.delayMs = Math.min(
      Math.max(this.delayMs * 2, 500),
      AdaptiveThrottler.CEILING_MS,
    );
  }

  noteTransient(): void {
    this.delayMs = Math.min(
      Math.max(this.delayMs * 1.5, 300),
      AdaptiveThrottler.CEILING_MS,
    );
  }

  noteSuccess(): void {
    if (this.delayMs > AdaptiveThrottler.BASELINE_MS) {
      this.delayMs = Math.max(AdaptiveThrottler.BASELINE_MS, this.delayMs * 0.97);
    }
  }

  get currentDelayMs(): number {
    return this.delayMs;
  }
}

export const itunesThrottler = new AdaptiveThrottler();

export async function lookupItunesDetailed(
  bundleId: string,
  country: string,
): Promise<ItunesLookupDetailedOutcome> {
  await itunesThrottler.wait();
  try {
    const url = `${ITUNES_LOOKUP_URL}?bundleId=${encodeURIComponent(bundleId)}&country=${country}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS) });
    // 404 = app not sold in this storefront. Normal "not in this region".
    if (res.status === 404) {
      itunesThrottler.noteSuccess();
      return { kind: "not_found" };
    }
    if (res.status === 403 || res.status === 429) {
      itunesThrottler.noteThrottle();
      return { kind: "rate_limited", status: res.status };
    }
    if (res.status >= 500 && res.status < 600) {
      itunesThrottler.noteTransient();
      return { kind: "transient", message: `HTTP ${res.status}` };
    }
    if (!res.ok) return { kind: "error", message: `HTTP ${res.status}` };
    const data = (await res.json()) as ItunesLookupResponse;
    itunesThrottler.noteSuccess();
    const result = data.results?.[0];
    if (!result) return { kind: "not_found" };
    return { kind: "found", result };
  } catch (err) {
    // Network failures, AbortSignal timeouts, DNS hiccups — all retry-worthy.
    itunesThrottler.noteTransient();
    return { kind: "transient", message: err instanceof Error ? err.message : String(err) };
  }
}

// Simple outcome wrapper for callers that don't care about retry classes
// (app_version_sync, on-demand routes). Collapses rate_limited + transient
// into plain errors. The shared throttler still observes the call so even
// these "fire and forget" callers contribute to and benefit from the
// process-wide backoff state.
export async function lookupItunes(
  bundleId: string,
  country: string,
): Promise<ItunesLookupOutcome> {
  const detailed = await lookupItunesDetailed(bundleId, country);
  switch (detailed.kind) {
    case "found":
    case "not_found":
    case "error":
      return detailed;
    case "rate_limited":
      return { kind: "error", message: `rate limited (HTTP ${detailed.status})` };
    case "transient":
      return { kind: "error", message: detailed.message };
  }
}
