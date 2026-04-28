import { eq, and, isNull, sql } from "drizzle-orm";
import { apps, appStoreRatings } from "@owlmetry/db";
import { APPLE_STOREFRONT_CODES } from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";
import type { NotificationDispatcher } from "../services/notifications/dispatcher.js";
import { resolveTeamMemberUserIds } from "../utils/team-members.js";
import { IS_TEST, itunesThrottler, lookupItunesDetailed } from "../utils/itunes-lookup.js";

const APP_STORE = "app_store" as const;

// Per-storefront retry budget. Exponential backoff capped at 60s; with 8
// attempts that's ~2 minutes worst case per storefront. Anything still
// failing after that gets picked up tomorrow. The shared `itunesThrottler`
// (in utils/itunes-lookup) handles inter-request pacing globally — this is
// just the per-call retry-and-give-up loop.
const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = IS_TEST ? 0 : 1_000;
const BACKOFF_CAP_MS = IS_TEST ? 0 : 60_000;

function backoffDelay(attempt: number): number {
  if (BACKOFF_BASE_MS === 0) return 0;
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
  // ±25% jitter so retries spread out.
  return exp * (0.75 + Math.random() * 0.5);
}

interface StorefrontRating {
  averageRating: number | null;
  ratingCount: number;
  currentVersionAverageRating: number | null;
  currentVersionRatingCount: number | null;
  appVersion: string | null;
}

type StorefrontOutcome =
  | { kind: "found"; rating: StorefrontRating }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

interface SyncStats {
  throttleHits: number;
  transientHits: number;
  retries: number;
  retriesExhausted: number;
}

async function lookupStorefront(
  bundleId: string,
  country: string,
  isCancelled: () => boolean,
  stats: SyncStats,
): Promise<StorefrontOutcome> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (isCancelled()) return { kind: "error", message: "cancelled" };
    // lookupItunesDetailed waits on the shared throttler and updates it from
    // the response — we just count outcomes here for job-level observability.
    const lookup = await lookupItunesDetailed(bundleId, country);

    if (lookup.kind === "rate_limited" || lookup.kind === "transient") {
      if (lookup.kind === "rate_limited") stats.throttleHits++;
      else stats.transientHits++;
      if (attempt >= MAX_ATTEMPTS) {
        stats.retriesExhausted++;
        const reason =
          lookup.kind === "rate_limited"
            ? `rate limited (HTTP ${lookup.status})`
            : `transient (${lookup.message})`;
        return { kind: "error", message: `${reason} after ${attempt} attempts` };
      }
      stats.retries++;
      const delay = backoffDelay(attempt);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (lookup.kind === "error") return lookup;

    if (lookup.kind === "not_found") return { kind: "not_found" };

    const r = lookup.result;
    const ratingCount = typeof r.userRatingCount === "number" ? r.userRatingCount : 0;
    const averageRating = typeof r.averageUserRating === "number" ? r.averageUserRating : null;
    // iTunes occasionally returns a result row with no rating data at all
    // (e.g. app present in the storefront but with zero ratings). Treat as
    // not_found so we don't store a 0-count row that displaces a real one.
    if (averageRating === null && ratingCount === 0) return { kind: "not_found" };
    return {
      kind: "found",
      rating: {
        averageRating,
        ratingCount,
        currentVersionAverageRating:
          typeof r.averageUserRatingForCurrentVersion === "number"
            ? r.averageUserRatingForCurrentVersion
            : null,
        currentVersionRatingCount:
          typeof r.userRatingCountForCurrentVersion === "number"
            ? r.userRatingCountForCurrentVersion
            : null,
        appVersion: typeof r.version === "string" ? r.version : null,
      },
    };
  }
  return { kind: "error", message: "max retries exhausted" };
}

export function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Daily Apple App Store ratings fan-out. For every Apple app with a bundle_id,
 * loops every iTunes storefront (~247 ISO2 codes) and writes a daily snapshot
 * row in app_store_ratings keyed on (app_id, store, country, snapshot_date).
 *
 * Tombstone rows (average_rating IS NULL, rating_count = 0) are written when a
 * storefront previously had data but iTunes returns nothing today — signalling
 * the app was delisted from that region. Storefronts that never had data are
 * silently skipped to keep the table sparse.
 *
 * After all storefronts for an app are synced, recomputes the worldwide-cache
 * columns on `apps` (denormalized weighted average + total count over the
 * latest snapshot per country, ignoring tombstones). Then, if the worldwide
 * count went up vs. the pre-update value, fires `app.rating_changed` to every
 * team member. First-sync (oldCount === null) is suppressed so onboarding a new
 * app doesn't dump a notification on every team member.
 */
export function appStoreRatingsSyncHandler(
  dispatcher: NotificationDispatcher,
): JobHandler {
  return async (ctx, params) => {
    const targetAppId = typeof params.app_id === "string" ? params.app_id : null;
    const targetProjectId = typeof params.project_id === "string" ? params.project_id : null;

    const conditions = [eq(apps.platform, "apple"), isNull(apps.deleted_at)];
    if (targetAppId) conditions.push(eq(apps.id, targetAppId));
    if (targetProjectId) conditions.push(eq(apps.project_id, targetProjectId));

    const targetApps = await ctx.db
      .select({
        id: apps.id,
        name: apps.name,
        team_id: apps.team_id,
        project_id: apps.project_id,
        bundle_id: apps.bundle_id,
        worldwide_rating_count_before: apps.worldwide_rating_count,
      })
      .from(apps)
      .where(and(...conditions));

    let appsProcessed = 0;
    let appsSkipped = 0;
    let storefrontsFetched = 0;
    let rowsUpserted = 0;
    let tombstonesWritten = 0;
    let errors = 0;
    let notificationsSent = 0;
    const stats: SyncStats = {
      throttleHits: 0,
      transientHits: 0,
      retries: 0,
      retriesExhausted: 0,
    };

    const client = ctx.createClient();
    const today = todayUtcDateString();

    try {
      for (const app of targetApps) {
        if (ctx.isCancelled()) break;
        if (!app.bundle_id) {
          appsSkipped++;
          continue;
        }

        // Countries that previously had real (non-tombstone) data — if iTunes
        // returns nothing for one of these today, write a tombstone.
        const previouslyActive = await client<{ country_code: string }[]>`
          SELECT DISTINCT country_code
          FROM (
            SELECT DISTINCT ON (country_code) country_code, average_rating
            FROM app_store_ratings
            WHERE app_id = ${app.id} AND store = ${APP_STORE}
            ORDER BY country_code, snapshot_date DESC
          ) latest
          WHERE average_rating IS NOT NULL
        `;
        const previouslyActiveSet = new Set(previouslyActive.map((r) => r.country_code));

        const upsertRows: Array<{
          team_id: string;
          project_id: string;
          app_id: string;
          store: string;
          country_code: string;
          average_rating: string | null;
          rating_count: number;
          current_version_average_rating: string | null;
          current_version_rating_count: number | null;
          app_version: string | null;
          snapshot_date: string;
        }> = [];

        for (const country of APPLE_STOREFRONT_CODES) {
          if (ctx.isCancelled()) break;

          const result = await lookupStorefront(
            app.bundle_id,
            country,
            () => ctx.isCancelled(),
            stats,
          );
          storefrontsFetched++;

          if (result.kind === "error") {
            errors++;
            continue;
          }

          if (result.kind === "found") {
            upsertRows.push({
              team_id: app.team_id,
              project_id: app.project_id,
              app_id: app.id,
              store: APP_STORE,
              country_code: country,
              average_rating:
                result.rating.averageRating !== null
                  ? result.rating.averageRating.toFixed(2)
                  : null,
              rating_count: result.rating.ratingCount,
              current_version_average_rating:
                result.rating.currentVersionAverageRating !== null
                  ? result.rating.currentVersionAverageRating.toFixed(2)
                  : null,
              current_version_rating_count: result.rating.currentVersionRatingCount,
              app_version: result.rating.appVersion,
              snapshot_date: today,
            });
          } else if (previouslyActiveSet.has(country)) {
            upsertRows.push({
              team_id: app.team_id,
              project_id: app.project_id,
              app_id: app.id,
              store: APP_STORE,
              country_code: country,
              average_rating: null,
              rating_count: 0,
              current_version_average_rating: null,
              current_version_rating_count: null,
              app_version: null,
              snapshot_date: today,
            });
            tombstonesWritten++;
          }
        }

        if (upsertRows.length > 0) {
          await ctx.db
            .insert(appStoreRatings)
            .values(upsertRows)
            .onConflictDoUpdate({
              target: [
                appStoreRatings.app_id,
                appStoreRatings.store,
                appStoreRatings.country_code,
                appStoreRatings.snapshot_date,
              ],
              set: {
                average_rating: sql`EXCLUDED.average_rating`,
                rating_count: sql`EXCLUDED.rating_count`,
                current_version_average_rating: sql`EXCLUDED.current_version_average_rating`,
                current_version_rating_count: sql`EXCLUDED.current_version_rating_count`,
                app_version: sql`EXCLUDED.app_version`,
              },
            });
          rowsUpserted += upsertRows.length;
        }

        // Recompute worldwide cache from the latest snapshot per country.
        // Numeric columns come back as strings from postgres-js; parseFloat them.
        const latest = await client<
          {
            country_code: string;
            average_rating: string | null;
            rating_count: number;
            current_version_average_rating: string | null;
            current_version_rating_count: number | null;
          }[]
        >`
          SELECT DISTINCT ON (country_code)
            country_code, average_rating, rating_count,
            current_version_average_rating, current_version_rating_count
          FROM app_store_ratings
          WHERE app_id = ${app.id} AND store = ${APP_STORE}
          ORDER BY country_code, snapshot_date DESC
        `;

        let weightedSum = 0;
        let totalCount = 0;
        let cvWeightedSum = 0;
        let cvTotalCount = 0;
        for (const row of latest) {
          if (row.average_rating !== null && row.rating_count > 0) {
            weightedSum += parseFloat(row.average_rating) * row.rating_count;
            totalCount += row.rating_count;
          }
          if (
            row.current_version_average_rating !== null &&
            row.current_version_rating_count !== null &&
            row.current_version_rating_count > 0
          ) {
            cvWeightedSum +=
              parseFloat(row.current_version_average_rating) * row.current_version_rating_count;
            cvTotalCount += row.current_version_rating_count;
          }
        }

        const newAverage = totalCount > 0 ? (weightedSum / totalCount).toFixed(2) : null;
        const newCount = totalCount > 0 ? totalCount : null;

        await ctx.db
          .update(apps)
          .set({
            worldwide_average_rating: newAverage,
            worldwide_rating_count: newCount,
            worldwide_current_version_rating:
              cvTotalCount > 0 ? (cvWeightedSum / cvTotalCount).toFixed(2) : null,
            worldwide_current_version_rating_count: cvTotalCount > 0 ? cvTotalCount : null,
            ratings_synced_at: new Date(),
          })
          .where(eq(apps.id, app.id));

        // Fire a notification when the worldwide rating count goes up. Skip
        // first-sync (oldCount null) so onboarding a fresh app doesn't push
        // every team member with the initial cumulative count.
        const oldCount = app.worldwide_rating_count_before;
        if (oldCount !== null && newCount !== null && newCount > oldCount) {
          const delta = newCount - oldCount;
          const userIds = await resolveTeamMemberUserIds(ctx.db, app.team_id);
          if (userIds.length > 0) {
            await dispatcher.enqueue({
              type: "app.rating_changed",
              userIds,
              teamId: app.team_id,
              payload: {
                title: `${delta} new rating${delta === 1 ? "" : "s"} on ${app.name}`,
                body: newAverage
                  ? `Average is now ${newAverage}★ across ${newCount} ratings.`
                  : `Now at ${newCount} ratings.`,
                link: `/dashboard/projects/${app.project_id}`,
                data: {
                  app_id: app.id,
                  app_name: app.name,
                  project_id: app.project_id,
                  old_count: oldCount,
                  new_count: newCount,
                  delta,
                  average_rating: newAverage,
                },
              },
            });
            notificationsSent++;
          }
        }

        appsProcessed++;
        await ctx.updateProgress({
          processed: appsProcessed,
          total: targetApps.length,
          message:
            `Processed ${appsProcessed}/${targetApps.length} apps ` +
            `(${rowsUpserted} rows, ${tombstonesWritten} tombstones, ` +
            `${stats.throttleHits} throttles, delay ${Math.round(itunesThrottler.currentDelayMs)}ms)`,
        });
      }
    } finally {
      await client.end();
    }

    return {
      apps_processed: appsProcessed,
      apps_skipped: appsSkipped,
      storefronts_fetched: storefrontsFetched,
      rows_upserted: rowsUpserted,
      tombstones_written: tombstonesWritten,
      notifications_sent: notificationsSent,
      errors,
      throttle_hits: stats.throttleHits,
      transient_hits: stats.transientHits,
      retries: stats.retries,
      retries_exhausted: stats.retriesExhausted,
      final_delay_ms: Math.round(itunesThrottler.currentDelayMs),
      _silent:
        appsProcessed === 0 && appsSkipped === 0 && errors === 0 && notificationsSent === 0,
    };
  };
}
