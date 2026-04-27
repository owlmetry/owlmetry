import { eq, isNull, and, isNotNull } from "drizzle-orm";
import { apps, appStoreReviews } from "@owlmetry/db";
import { APPLE_APP_STORE_COUNTRIES } from "@owlmetry/shared/app-store-countries";
import type { JobHandler } from "../services/job-runner.js";

const ITUNES_RSS_TIMEOUT_MS = 10_000;
const ITUNES_LOOKUP_TIMEOUT_MS = 10_000;
const ITUNES_RSS_INTER_REQUEST_DELAY_MS = 100;
const APP_STORE = "app_store";

// On-demand iTunes Lookup so the reviews job can resolve the numeric Apple App
// Store ID (trackId) for newly-created apps without depending on app_version_sync
// having already run. Mirrors the lookup in app-version-sync.ts but only returns
// the trackId since that's the single field this job needs.
async function lookupAppleTrackId(bundleId: string): Promise<number | null> {
  try {
    const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=us`;
    const res = await fetch(url, { signal: AbortSignal.timeout(ITUNES_LOOKUP_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ trackId?: number }> };
    const trackId = data.results?.[0]?.trackId;
    return typeof trackId === "number" ? trackId : null;
  } catch {
    return null;
  }
}

// Apple's RSS payload — typed loosely because the feed wraps everything in `label` objects
// and may include or omit fields per entry. We pull only the bits we need.
interface RssEntryAuthor {
  name?: { label?: string };
  uri?: { label?: string };
}

interface RssEntryAttribute {
  label?: string;
}

interface RssEntry {
  id?: { label?: string };
  title?: { label?: string };
  content?: { label?: string };
  "im:rating"?: RssEntryAttribute;
  "im:version"?: RssEntryAttribute;
  "im:voteSum"?: RssEntryAttribute;
  author?: RssEntryAuthor;
  updated?: { label?: string };
}

interface RssFeed {
  feed?: {
    entry?: RssEntry | RssEntry[];
  };
}

interface ParsedReview {
  external_id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewer_name: string | null;
  app_version: string | null;
  created_at_in_store: Date;
}

function parseRssEntry(entry: RssEntry): ParsedReview | null {
  const externalId = entry.id?.label?.trim();
  const ratingRaw = entry["im:rating"]?.label;
  const body = entry.content?.label?.trim();
  if (!externalId || !ratingRaw || !body) return null;
  const rating = Number.parseInt(ratingRaw, 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const updatedRaw = entry.updated?.label;
  const createdAt = updatedRaw ? new Date(updatedRaw) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
  return {
    external_id: externalId,
    rating,
    title: entry.title?.label?.trim() || null,
    body,
    reviewer_name: entry.author?.name?.label?.trim() || null,
    app_version: entry["im:version"]?.label?.trim() || null,
    created_at_in_store: createdAt,
  };
}

type FetchResult =
  | { kind: "ok"; reviews: ParsedReview[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

async function fetchReviewsForCountry(
  appleAppStoreId: number,
  country: string,
): Promise<FetchResult> {
  const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=1/id=${appleAppStoreId}/sortBy=mostRecent/json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ITUNES_RSS_TIMEOUT_MS) });
    // 4xx (commonly 404 when an app isn't available in a storefront) → treat as empty.
    if (res.status >= 400 && res.status < 500) return { kind: "empty" };
    if (!res.ok) return { kind: "error", message: `HTTP ${res.status}` };
    const data = (await res.json()) as RssFeed;
    const rawEntries = data?.feed?.entry;
    if (!rawEntries) return { kind: "empty" };
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    // The first entry in Apple's reviews RSS is the app metadata, not a review.
    // Guard by requiring `im:rating` to be present.
    const reviews = entries
      .filter((e) => e["im:rating"]?.label !== undefined)
      .map(parseRssEntry)
      .filter((r): r is ParsedReview => r !== null);
    if (reviews.length === 0) return { kind: "empty" };
    return { kind: "ok", reviews };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export const appReviewsSyncHandler: JobHandler = async (ctx, params) => {
  const targetAppId = typeof params.app_id === "string" ? params.app_id : null;

  const baseQuery = ctx.db
    .select({
      id: apps.id,
      team_id: apps.team_id,
      project_id: apps.project_id,
      apple_app_store_id: apps.apple_app_store_id,
      bundle_id: apps.bundle_id,
      platform: apps.platform,
    })
    .from(apps);

  // Apple platform apps that have either a numeric App Store ID already cached, or
  // a bundle_id we can resolve to one on the fly. Non-Apple apps are skipped (Play
  // Store ingest is a future phase).
  const allApps = targetAppId
    ? await baseQuery.where(
        and(
          eq(apps.id, targetAppId),
          isNull(apps.deleted_at),
          eq(apps.platform, "apple"),
          isNotNull(apps.bundle_id),
        ),
      )
    : await baseQuery.where(
        and(isNull(apps.deleted_at), eq(apps.platform, "apple"), isNotNull(apps.bundle_id)),
      );

  let appsProcessed = 0;
  let countriesAttempted = 0;
  let countriesWithReviews = 0;
  let reviewsIngested = 0;
  let reviewsSkippedDuplicate = 0;
  let errors = 0;
  let firstCountryRequest = true;

  for (const app of allApps) {
    if (ctx.isCancelled()) break;

    // Resolve the numeric App Store ID on demand if we don't have one yet — this
    // covers brand-new apps where the on-create app_version_sync hasn't finished.
    let appleAppStoreId = app.apple_app_store_id;
    if (!appleAppStoreId && app.bundle_id) {
      appleAppStoreId = await lookupAppleTrackId(app.bundle_id);
      if (appleAppStoreId) {
        await ctx.db
          .update(apps)
          .set({ apple_app_store_id: appleAppStoreId })
          .where(eq(apps.id, app.id));
      }
    }
    if (!appleAppStoreId) continue;

    for (const country of APPLE_APP_STORE_COUNTRIES) {
      if (ctx.isCancelled()) break;
      if (!firstCountryRequest) {
        await new Promise((r) => setTimeout(r, ITUNES_RSS_INTER_REQUEST_DELAY_MS));
      }
      firstCountryRequest = false;

      countriesAttempted++;
      const result = await fetchReviewsForCountry(appleAppStoreId, country);
      if (result.kind === "error") {
        errors++;
        ctx.log.warn(
          { app_id: app.id, country, message: result.message },
          "iTunes RSS fetch failed",
        );
        continue;
      }
      if (result.kind === "empty") continue;
      countriesWithReviews++;

      // Insert this country's reviews; ON CONFLICT DO NOTHING gives idempotency.
      const rows = result.reviews.map((review) => ({
        team_id: app.team_id,
        project_id: app.project_id,
        app_id: app.id,
        store: APP_STORE,
        external_id: review.external_id,
        rating: review.rating,
        title: review.title,
        body: review.body,
        reviewer_name: review.reviewer_name,
        country_code: country,
        app_version: review.app_version,
        language_code: null,
        created_at_in_store: review.created_at_in_store,
      }));

      const inserted = await ctx.db
        .insert(appStoreReviews)
        .values(rows)
        .onConflictDoNothing({
          target: [appStoreReviews.app_id, appStoreReviews.store, appStoreReviews.external_id],
        })
        .returning({ id: appStoreReviews.id });

      reviewsIngested += inserted.length;
      reviewsSkippedDuplicate += rows.length - inserted.length;
    }

    appsProcessed++;
    await ctx.updateProgress({
      processed: appsProcessed,
      total: allApps.length,
      message: `Processed ${appsProcessed}/${allApps.length} apps (${reviewsIngested} new reviews)`,
    });
  }

  return {
    apps_processed: appsProcessed,
    countries_attempted: countriesAttempted,
    countries_with_reviews: countriesWithReviews,
    reviews_ingested: reviewsIngested,
    reviews_skipped_duplicate: reviewsSkippedDuplicate,
    errors,
    _silent: reviewsIngested === 0 && errors === 0,
  };
};
