import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { apps, appStoreReviews } from "@owlmetry/db";
import { iso3ToIso2 } from "@owlmetry/shared/app-store-countries";
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
 * pagination — for each page we insert with ON CONFLICT DO NOTHING and stop the
 * whole sync for that app as soon as a page contains a review we already have
 * (the unique index on `(app_id, store, external_id)` makes re-runs cheap).
 *
 * Auth failures abort the entire run early — every subsequent app would fail
 * the same way against the same credentials.
 */
export const appStoreConnectReviewsSyncHandler: JobHandler = async (ctx, params) => {
  const projectId = params.project_id as string;
  if (!projectId) throw new Error("project_id is required");

  const integration = await findActiveIntegration(ctx.db, projectId, "app-store-connect");
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
  let errors = 0;
  const errorStatusCounts: Record<string, number> = {};
  let aborted = false;
  let abortReason: string | null = null;

  outer: for (const app of targetApps) {
    if (ctx.isCancelled()) break;
    if (!app.apple_app_store_id) continue;

    let cursorUrl: string | undefined;
    let appPagesFetched = 0;
    let stopThisApp = false;

    while (!stopThisApp) {
      if (ctx.isCancelled()) break outer;

      const result = await listAppStoreConnectReviews(ascConfig, app.apple_app_store_id, {
        cursorUrl,
      });

      if (result.status === "auth_error") {
        aborted = true;
        abortReason = `auth_error: ${result.message}`;
        break outer;
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
        // doesn't have access to that team's apps). Move on quietly.
        break;
      }

      const { reviews, nextCursor } = result.data;
      pagesFetched++;
      appPagesFetched++;

      if (reviews.length === 0) break;

      const inserted = await insertReviewsPage(ctx.db, app, reviews);
      reviewsIngested += inserted.inserted;
      reviewsSkippedDuplicate += inserted.duplicates;

      // Stop pagination if any review on this page was already in the DB —
      // because reviews come back newest-first, anything older than the first
      // duplicate is also already present.
      if (inserted.duplicates > 0) stopThisApp = true;

      if (!nextCursor) break;
      cursorUrl = nextCursor;
    }

    appsProcessed++;
    await ctx.updateProgress({
      processed: appsProcessed,
      total: targetApps.length,
      message: `Processed ${appsProcessed}/${targetApps.length} apps (${reviewsIngested} new reviews, ${appPagesFetched} pages this app)`,
    });
  }

  return {
    apps_processed: appsProcessed,
    pages_fetched: pagesFetched,
    reviews_ingested: reviewsIngested,
    reviews_skipped_duplicate: reviewsSkippedDuplicate,
    errors,
    error_status_counts: errorStatusCounts,
    aborted,
    abort_reason: abortReason,
    _silent: !aborted && reviewsIngested === 0 && errors === 0,
  };
};

interface InsertResult {
  inserted: number;
  duplicates: number;
}

async function insertReviewsPage(
  db: Parameters<JobHandler>[0]["db"],
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
