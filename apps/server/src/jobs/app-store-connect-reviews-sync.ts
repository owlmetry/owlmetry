import { eq, and, isNull, isNotNull, inArray } from "drizzle-orm";
import { apps, appStoreReviews, type Db } from "@owlmetry/db";
import { iso3ToIso2, INTEGRATION_PROVIDER_IDS } from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";
import { findActiveIntegration } from "../utils/integrations.js";
import {
  listAppStoreConnectReviews,
  type AppStoreConnectReview,
} from "../utils/app-store-connect/client.js";
import type { AppStoreConnectConfig } from "../utils/app-store-connect/config.js";

const APP_STORE = "app_store" as const;

/**
 * Sweeps every Apple app in the project that has a populated apple_app_store_id
 * and pulls App Store reviews via the customerReviews endpoint. Newest-first
 * pagination — pages all the way through for every app so we have a complete
 * picture of what ASC currently exposes, then reconciles: anything in our DB
 * for that app whose `external_id` didn't show up in ASC is hard-deleted.
 * Inserts use ON CONFLICT DO NOTHING on `(app_id, store, external_id)` so
 * already-present rows stay put across re-runs.
 *
 * Reconciliation only runs when pagination completed cleanly for that app —
 * partial failures (transport error, rate-limit abort, cancellation) skip the
 * delete step so we never wipe rows from an incomplete view.
 *
 * Auth failures abort the entire run early — every subsequent app would fail
 * the same way against the same credentials.
 */
export const appStoreConnectReviewsSyncHandler: JobHandler = async (ctx, params) => {
  const projectId = params.project_id as string;
  if (!projectId) throw new Error("project_id is required");

  const integration = await findActiveIntegration(
    ctx.db,
    projectId,
    INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT,
  );
  if (!integration) {
    throw new Error("App Store Connect integration not found or disabled");
  }
  const ascConfig = integration.config as unknown as AppStoreConnectConfig;

  const targetApps = await ctx.db
    .select({
      id: apps.id,
      team_id: apps.team_id,
      project_id: apps.project_id,
      apple_app_store_id: apps.apple_app_store_id,
    })
    .from(apps)
    .where(
      and(
        eq(apps.project_id, projectId),
        eq(apps.platform, "apple"),
        isNotNull(apps.apple_app_store_id),
        isNull(apps.deleted_at),
      ),
    );

  let appsProcessed = 0;
  let pagesFetched = 0;
  let reviewsIngested = 0;
  let reviewsSkippedDuplicate = 0;
  let reviewsDeleted = 0;
  let errors = 0;
  let rateLimitWaits = 0;
  const errorStatusCounts: Record<string, number> = {};
  let aborted = false;
  let abortReason: string | null = null;
  // Cap total rate-limit waiting at 10 minutes per run to avoid syncs that
  // never end if Apple is throttling hard. The next scheduled / manual run
  // will pick up where we left off (idempotent re-runs).
  const MAX_RATE_LIMIT_WAIT_SECONDS = 600;
  let totalRateLimitWaitSeconds = 0;

  outer: for (const app of targetApps) {
    if (ctx.isCancelled()) break;
    if (!app.apple_app_store_id) continue;

    let cursorUrl: string | undefined;
    let appPagesFetched = 0;
    let paginatedFully = false;
    const seenExternalIds = new Set<string>();

    while (true) {
      if (ctx.isCancelled()) break outer;

      const result = await listAppStoreConnectReviews(ascConfig, app.apple_app_store_id, {
        cursorUrl,
      });

      if (result.status === "auth_error") {
        aborted = true;
        abortReason = `auth_error: ${result.message}`;
        break outer;
      }
      if (result.status === "rate_limited") {
        rateLimitWaits++;
        if (totalRateLimitWaitSeconds + result.retryAfterSeconds > MAX_RATE_LIMIT_WAIT_SECONDS) {
          aborted = true;
          abortReason = `rate_limited: cumulative wait would exceed ${MAX_RATE_LIMIT_WAIT_SECONDS}s — bailing, next run will resume`;
          break outer;
        }
        totalRateLimitWaitSeconds += result.retryAfterSeconds;
        ctx.log.warn(
          { app_id: app.id, retryAfterSeconds: result.retryAfterSeconds },
          "App Store Connect rate-limited, sleeping",
        );
        await new Promise((r) => setTimeout(r, result.retryAfterSeconds * 1000));
        continue; // retry the same cursor
      }
      if (result.status === "error") {
        errors++;
        const key = `error_${result.statusCode}`;
        errorStatusCounts[key] = (errorStatusCounts[key] ?? 0) + 1;
        ctx.log.warn(
          { app_id: app.id, statusCode: result.statusCode, message: result.message },
          "App Store Connect reviews fetch failed",
        );
        break;
      }
      if (result.status === "not_found") {
        // App not visible to this ASC key (e.g. removed from sale, or key
        // doesn't have access to that team's apps). Move on quietly without
        // reconciling — a transient access loss must not wipe rows.
        break;
      }

      const { reviews, nextCursor } = result.data;
      pagesFetched++;
      appPagesFetched++;

      for (const review of reviews) seenExternalIds.add(review.id);

      if (reviews.length > 0) {
        const inserted = await insertReviewsPage(ctx.db, app, reviews);
        reviewsIngested += inserted.inserted;
        reviewsSkippedDuplicate += inserted.duplicates;
      }

      if (!nextCursor) {
        paginatedFully = true;
        break;
      }
      cursorUrl = nextCursor;
    }

    if (paginatedFully) {
      const deleted = await reconcileApp(ctx.db, app.id, seenExternalIds);
      reviewsDeleted += deleted;
    }

    appsProcessed++;
    await ctx.updateProgress({
      processed: appsProcessed,
      total: targetApps.length,
      message: `Processed ${appsProcessed}/${targetApps.length} apps (${reviewsIngested} new, ${reviewsDeleted} removed, ${appPagesFetched} pages this app)`,
    });
  }

  return {
    apps_processed: appsProcessed,
    pages_fetched: pagesFetched,
    reviews_ingested: reviewsIngested,
    reviews_skipped_duplicate: reviewsSkippedDuplicate,
    reviews_deleted: reviewsDeleted,
    errors,
    error_status_counts: errorStatusCounts,
    rate_limit_waits: rateLimitWaits,
    rate_limit_wait_seconds: totalRateLimitWaitSeconds,
    aborted,
    abort_reason: abortReason,
    _silent:
      !aborted &&
      reviewsIngested === 0 &&
      reviewsDeleted === 0 &&
      errors === 0 &&
      rateLimitWaits === 0,
  };
};

// Diff existing-by-app against the seen set in JS, then delete the stale rows
// in chunks. Avoids `NOT IN (... 50k params)` blowing past Postgres's ~32k
// bind-parameter ceiling on apps with very large review catalogs, and lets
// the empty-seen-set case fall out of the same code path.
const RECONCILE_DELETE_CHUNK = 1000;

async function reconcileApp(
  db: Db,
  appId: string,
  seenExternalIds: Set<string>,
): Promise<number> {
  const existing = await db
    .select({ id: appStoreReviews.id, external_id: appStoreReviews.external_id })
    .from(appStoreReviews)
    .where(and(eq(appStoreReviews.app_id, appId), eq(appStoreReviews.store, APP_STORE)));

  const staleIds = existing.filter((r) => !seenExternalIds.has(r.external_id)).map((r) => r.id);
  if (staleIds.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < staleIds.length; i += RECONCILE_DELETE_CHUNK) {
    const chunk = staleIds.slice(i, i + RECONCILE_DELETE_CHUNK);
    const removed = await db
      .delete(appStoreReviews)
      .where(inArray(appStoreReviews.id, chunk))
      .returning({ id: appStoreReviews.id });
    deleted += removed.length;
  }
  return deleted;
}

interface InsertResult {
  inserted: number;
  duplicates: number;
}

async function insertReviewsPage(
  db: Db,
  app: { id: string; team_id: string; project_id: string },
  reviews: AppStoreConnectReview[],
): Promise<InsertResult> {
  if (reviews.length === 0) return { inserted: 0, duplicates: 0 };

  const rows = reviews.map((review) => ({
    team_id: app.team_id,
    project_id: app.project_id,
    app_id: app.id,
    store: APP_STORE,
    external_id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    reviewer_name: review.reviewer_nickname,
    country_code: iso3ToIso2(review.territory),
    app_version: null,
    language_code: null,
    developer_response: review.developer_response,
    developer_response_at: review.developer_response_at,
    developer_response_id: review.developer_response_id,
    developer_response_state: review.developer_response_state,
    created_at_in_store: review.created_at,
  }));

  const insertedRows = await db
    .insert(appStoreReviews)
    .values(rows)
    .onConflictDoNothing({
      target: [appStoreReviews.app_id, appStoreReviews.store, appStoreReviews.external_id],
    })
    .returning({ id: appStoreReviews.id });

  return {
    inserted: insertedRows.length,
    duplicates: rows.length - insertedRows.length,
  };
}
