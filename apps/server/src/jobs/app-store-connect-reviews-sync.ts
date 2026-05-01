import { eq, and, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { apps, appStoreReviews, projectIntegrations, type Db } from "@owlmetry/db";
import { iso3ToIso2, INTEGRATION_PROVIDER_IDS } from "@owlmetry/shared";
import type { JobContext, JobHandler } from "../services/job-runner.js";
import type { NotificationDispatcher } from "../services/notifications/dispatcher.js";
import { resolveTeamMemberUserIds } from "../utils/team-members.js";
import { findActiveIntegration } from "../utils/integrations.js";
import {
  fetchCustomerReviewResponse,
  listAppStoreConnectReviews,
  type AppStoreConnectReview,
} from "../utils/app-store-connect/client.js";
import type { AppStoreConnectConfig } from "../utils/app-store-connect/config.js";

const APP_STORE = "app_store" as const;
const REVIEW_BODY_SNIPPET_MAX = 140;

type ProjectIntegrationRow = typeof projectIntegrations.$inferSelect;

// The `& Record<string, unknown>` intersection lets the return value of
// syncProject satisfy JobHandler's `Record<string, unknown>` shape while
// keeping per-field types intact for aggregation in the fan-out wrapper.
type ProjectSyncResult = {
  apps_processed: number;
  pages_fetched: number;
  reviews_ingested: number;
  reviews_updated: number;
  reviews_skipped_duplicate: number;
  reviews_deleted: number;
  pending_responses_checked: number;
  notifications_sent: number;
  errors: number;
  error_status_counts: Record<string, number>;
  rate_limit_waits: number;
  rate_limit_wait_seconds: number;
  aborted: boolean;
  abort_reason: string | null;
  _silent: boolean;
} & Record<string, unknown>;

/**
 * Sweeps every Apple app in the project that has a populated apple_app_store_id
 * and pulls App Store reviews via the customerReviews endpoint. Newest-first
 * pagination — pages all the way through for every app so we have a complete
 * picture of what ASC currently exposes, then reconciles: anything in our DB
 * for that app whose `external_id` didn't show up in ASC is hard-deleted.
 * Upserts use ON CONFLICT DO UPDATE on `(app_id, store, external_id)` —
 * reviewer-side fields (rating, title, body, etc.) stay frozen because Apple
 * treats them as immutable. `developer_response*` fields refresh from the
 * payload, but only when the incoming row has a non-null `developer_response_id`
 * (gated by `setWhere`) — Apple's customerReviews API doesn't surface
 * PENDING_PUBLISH replies and can transiently drop response data from the
 * `included` array, so a missing response is treated as "no signal," not "delete."
 * That keeps Owlmetry-originated PENDING replies intact and survives Apple-side
 * pagination quirks. `responded_by_user_id` is preserved on conflict — it's
 * local "who replied via Owlmetry" attribution that ASC doesn't carry.
 *
 * Reconciliation only runs when pagination completed cleanly for that app —
 * partial failures (transport error, rate-limit abort, cancellation) skip the
 * delete step so we never wipe rows from an incomplete view.
 *
 * After reconciliation (still gated on `paginatedFully`), runs a refresh pass
 * over local rows still marked `developer_response_state = 'PENDING_PUBLISH'`:
 * each is GET'd directly via `/v1/customerReviewResponses/{id}` because
 * Apple's customerReviews payload doesn't reliably surface the state flip
 * from PENDING_PUBLISH → PUBLISHED in the `included` array. 404 from that GET
 * means Apple removed the response externally → local fields are cleared.
 *
 * Auth failures abort the per-project run early — every subsequent app on the
 * same credentials would fail the same way. In fan-out mode the auth abort is
 * scoped to that project; the wrapper continues on to the next project.
 *
 * After each app's pagination completes, fires `app.review_new` to every team
 * member if at least one new review was ingested. First-sync (the app had
 * zero existing reviews before this run) is suppressed so connecting an ASC
 * integration to an app with hundreds of historical reviews doesn't dump a
 * notification storm — only incremental deltas thereafter.
 *
 * Modes:
 * - `params.project_id` set → single-project sync (manual-trigger path). Throws
 *   on missing/disabled integration so the dashboard's last-sync strip surfaces
 *   the error to the operator.
 * - `params.project_id` absent → fan-out across every active App Store Connect
 *   integration (daily 05:30 UTC schedule). Per-project failures are isolated
 *   in try/catch so one bad integration doesn't block the rest.
 */
export function appStoreConnectReviewsSyncHandler(
  dispatcher: NotificationDispatcher,
): JobHandler {
  return async (ctx, params) => {
    const targetProjectId = typeof params.project_id === "string" ? params.project_id : null;

    if (targetProjectId) {
      const integration = await findActiveIntegration(
        ctx.db,
        targetProjectId,
        INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT,
      );
      if (!integration) {
        throw new Error("App Store Connect integration not found or disabled");
      }
      return await syncProject(ctx, dispatcher, integration);
    }

    return await fanOutAcrossProjects(ctx, dispatcher);
  };
}

async function fanOutAcrossProjects(
  ctx: JobContext,
  dispatcher: NotificationDispatcher,
): Promise<Record<string, unknown>> {
  // Pull every non-deleted ASC integration row in one shot; classify
  // active vs inactive in JS so ops sees a "configured but disabled" count
  // separate from "synced cleanly" and "threw mid-sync."
  const candidates = await ctx.db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.provider, INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT),
        isNull(projectIntegrations.deleted_at),
      ),
    );

  let projectsProcessed = 0;
  let projectsSkippedInactive = 0;
  let projectsFailed = 0;
  let projectsAborted = 0;

  let appsProcessed = 0;
  let pagesFetched = 0;
  let reviewsIngested = 0;
  let reviewsUpdated = 0;
  let reviewsSkippedDuplicate = 0;
  let reviewsDeleted = 0;
  let pendingResponsesChecked = 0;
  let notificationsSent = 0;
  let errors = 0;
  let rateLimitWaits = 0;
  let rateLimitWaitSeconds = 0;
  const errorStatusCounts: Record<string, number> = {};

  for (const integration of candidates) {
    if (ctx.isCancelled()) break;

    if (!integration.enabled) {
      projectsSkippedInactive++;
      continue;
    }

    try {
      const r = await syncProject(ctx, dispatcher, integration);
      projectsProcessed++;
      if (r.aborted) projectsAborted++;
      appsProcessed += r.apps_processed;
      pagesFetched += r.pages_fetched;
      reviewsIngested += r.reviews_ingested;
      reviewsUpdated += r.reviews_updated;
      reviewsSkippedDuplicate += r.reviews_skipped_duplicate;
      reviewsDeleted += r.reviews_deleted;
      pendingResponsesChecked += r.pending_responses_checked;
      notificationsSent += r.notifications_sent;
      errors += r.errors;
      rateLimitWaits += r.rate_limit_waits;
      rateLimitWaitSeconds += r.rate_limit_wait_seconds;
      for (const [k, v] of Object.entries(r.error_status_counts)) {
        errorStatusCounts[k] = (errorStatusCounts[k] ?? 0) + v;
      }
    } catch (err) {
      projectsFailed++;
      ctx.log.warn(
        {
          project_id: integration.project_id,
          err: err instanceof Error ? err.message : String(err),
        },
        "App Store Connect reviews sync failed for project",
      );
    }

    await ctx.updateProgress({
      processed: projectsProcessed + projectsFailed + projectsSkippedInactive,
      total: candidates.length,
      message: `Processed ${projectsProcessed}/${candidates.length} projects (${reviewsIngested} new, ${reviewsDeleted} removed)`,
    });
  }

  return {
    projects_processed: projectsProcessed,
    projects_skipped_inactive: projectsSkippedInactive,
    projects_failed: projectsFailed,
    projects_aborted: projectsAborted,
    apps_processed: appsProcessed,
    pages_fetched: pagesFetched,
    reviews_ingested: reviewsIngested,
    reviews_updated: reviewsUpdated,
    reviews_skipped_duplicate: reviewsSkippedDuplicate,
    reviews_deleted: reviewsDeleted,
    pending_responses_checked: pendingResponsesChecked,
    notifications_sent: notificationsSent,
    errors,
    error_status_counts: errorStatusCounts,
    rate_limit_waits: rateLimitWaits,
    rate_limit_wait_seconds: rateLimitWaitSeconds,
    _silent:
      reviewsIngested === 0 &&
      reviewsUpdated === 0 &&
      reviewsDeleted === 0 &&
      errors === 0 &&
      rateLimitWaits === 0 &&
      notificationsSent === 0 &&
      projectsFailed === 0 &&
      projectsAborted === 0,
  };
}

async function syncProject(
  ctx: JobContext,
  dispatcher: NotificationDispatcher,
  integration: ProjectIntegrationRow,
): Promise<ProjectSyncResult> {
  const projectId = integration.project_id;
  const ascConfig = integration.config as unknown as AppStoreConnectConfig;

  const targetApps = await ctx.db
    .select({
      id: apps.id,
      name: apps.name,
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
  let reviewsUpdated = 0;
  let reviewsSkippedDuplicate = 0;
  let reviewsDeleted = 0;
  let pendingResponsesChecked = 0;
  let notificationsSent = 0;
  let errors = 0;
  let rateLimitWaits = 0;
  const errorStatusCounts: Record<string, number> = {};
  const teamMemberCache = new Map<string, string[]>();
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

    // Snapshot pre-existing review count so we can suppress the first-sync
    // notification (avoids dumping every historical review on a brand-new
    // ASC integration hookup).
    const [existingRow] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(appStoreReviews)
      .where(and(eq(appStoreReviews.app_id, app.id), eq(appStoreReviews.store, APP_STORE)));
    const existingBefore = existingRow?.count ?? 0;

    let cursorUrl: string | undefined;
    let appPagesFetched = 0;
    let paginatedFully = false;
    let perAppNewCount = 0;
    let firstNewReview: AppStoreConnectReview | null = null;
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
        continue;
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
        const upsertResult = await upsertReviewsPage(ctx.db, app, reviews);
        reviewsIngested += upsertResult.insertedReviews.length;
        reviewsUpdated += upsertResult.reviewsUpdated;
        // "skipped duplicate" post-upsert means: row existed AND its developer_response_*
        // fields matched what ASC reported, so the upsert was a true no-op. Tighter
        // signal than the old DO-NOTHING semantic (which only checked row existence).
        reviewsSkippedDuplicate +=
          reviews.length - upsertResult.insertedReviews.length - upsertResult.reviewsUpdated;
        perAppNewCount += upsertResult.insertedReviews.length;
        // ASC returns newest-first; the first non-empty inserted page holds
        // the absolute-newest new review across the run.
        if (firstNewReview === null && upsertResult.insertedReviews.length > 0) {
          firstNewReview = upsertResult.insertedReviews[0];
        }
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

    // Refresh PENDING_PUBLISH rows by direct GET on customerReviewResponses/{id}.
    // Apple's customerReviews payload doesn't reliably surface the state flip,
    // so without this pass Owlmetry-created replies stay stuck at PENDING_PUBLISH
    // even after Apple publishes them. Gated on `paginatedFully` to mirror the
    // reconcile-on-clean-run discipline; partial-pagination runs skip and the
    // next clean run handles them.
    if (paginatedFully && !aborted) {
      const refreshResult = await refreshPendingResponses(
        ctx,
        ascConfig,
        app.id,
        totalRateLimitWaitSeconds,
        MAX_RATE_LIMIT_WAIT_SECONDS,
      );
      reviewsUpdated += refreshResult.refreshed + refreshResult.cleared;
      errors += refreshResult.errors;
      rateLimitWaits += refreshResult.rateLimitWaits;
      totalRateLimitWaitSeconds = refreshResult.totalRateLimitWaitSeconds;
      pendingResponsesChecked += refreshResult.pendingChecked;
      for (const [k, v] of Object.entries(refreshResult.errorStatusCounts)) {
        errorStatusCounts[k] = (errorStatusCounts[k] ?? 0) + v;
      }
      if (refreshResult.aborted) {
        aborted = true;
        abortReason = refreshResult.abortReason;
        break outer;
      }
    }

    // Notify only when this app already had reviews on file before this run
    // and at least one new one was ingested. Skips first-sync onboarding
    // floods. Partial syncs (pagination errored mid-stream) still notify
    // about the rows we did manage to insert — the next run will catch up
    // without double-notifying because those rows now count as existing.
    if (existingBefore > 0 && perAppNewCount > 0) {
      let userIds = teamMemberCache.get(app.team_id);
      if (!userIds) {
        userIds = await resolveTeamMemberUserIds(ctx.db, app.team_id);
        teamMemberCache.set(app.team_id, userIds);
      }
      if (userIds.length > 0) {
        const snippet = firstNewReview ? truncate(firstNewReview.body, REVIEW_BODY_SNIPPET_MAX) : "";
        const stars = firstNewReview
          ? `${"★".repeat(firstNewReview.rating)}${"☆".repeat(Math.max(0, 5 - firstNewReview.rating))}`
          : "";
        await dispatcher.enqueue({
          type: "app.review_new",
          userIds,
          teamId: app.team_id,
          payload: {
            title: `${perAppNewCount} new review${perAppNewCount === 1 ? "" : "s"} on ${app.name}`,
            body: firstNewReview
              ? `Latest: ${stars} — ${snippet}`
              : `${perAppNewCount} new reviews ingested.`,
            link: `/dashboard/reviews?app_id=${app.id}`,
            data: {
              app_id: app.id,
              app_name: app.name,
              project_id: app.project_id,
              count: perAppNewCount,
              latest_review_id: firstNewReview?.id ?? null,
              latest_rating: firstNewReview?.rating ?? null,
              latest_title: firstNewReview?.title ?? null,
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
      message: `Processed ${appsProcessed}/${targetApps.length} apps (${reviewsIngested} new, ${reviewsDeleted} removed, ${appPagesFetched} pages this app)`,
    });
  }

  return {
    apps_processed: appsProcessed,
    pages_fetched: pagesFetched,
    reviews_ingested: reviewsIngested,
    reviews_updated: reviewsUpdated,
    reviews_skipped_duplicate: reviewsSkippedDuplicate,
    reviews_deleted: reviewsDeleted,
    pending_responses_checked: pendingResponsesChecked,
    notifications_sent: notificationsSent,
    errors,
    error_status_counts: errorStatusCounts,
    rate_limit_waits: rateLimitWaits,
    rate_limit_wait_seconds: totalRateLimitWaitSeconds,
    aborted,
    abort_reason: abortReason,
    _silent:
      !aborted &&
      reviewsIngested === 0 &&
      reviewsUpdated === 0 &&
      reviewsDeleted === 0 &&
      errors === 0 &&
      rateLimitWaits === 0 &&
      notificationsSent === 0,
  };
}

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

interface UpsertResult {
  insertedReviews: AppStoreConnectReview[];
  /** Existing rows whose developer_response_* fields actually changed. */
  reviewsUpdated: number;
}

async function upsertReviewsPage(
  db: Db,
  app: { id: string; team_id: string; project_id: string },
  reviews: AppStoreConnectReview[],
): Promise<UpsertResult> {
  if (reviews.length === 0) return { insertedReviews: [], reviewsUpdated: 0 };

  // Pre-fetch existing rows so we can classify post-upsert outcomes. ON CONFLICT
  // DO UPDATE returns every row regardless of whether columns actually changed,
  // so RETURNING alone can't distinguish insert vs. update vs. no-op.
  const externalIds = reviews.map((r) => r.id);
  const existing = await db
    .select({
      external_id: appStoreReviews.external_id,
      developer_response: appStoreReviews.developer_response,
      developer_response_at: appStoreReviews.developer_response_at,
      developer_response_id: appStoreReviews.developer_response_id,
      developer_response_state: appStoreReviews.developer_response_state,
    })
    .from(appStoreReviews)
    .where(
      and(
        eq(appStoreReviews.app_id, app.id),
        eq(appStoreReviews.store, APP_STORE),
        inArray(appStoreReviews.external_id, externalIds),
      ),
    );
  const existingByExtId = new Map(existing.map((r) => [r.external_id, r]));

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

  await db
    .insert(appStoreReviews)
    .values(rows)
    .onConflictDoUpdate({
      target: [appStoreReviews.app_id, appStoreReviews.store, appStoreReviews.external_id],
      set: {
        developer_response: sql`excluded.developer_response`,
        developer_response_at: sql`excluded.developer_response_at`,
        developer_response_id: sql`excluded.developer_response_id`,
        developer_response_state: sql`excluded.developer_response_state`,
        updated_at: sql`now()`,
      },
      // Only overwrite developer_response_* when the incoming payload actually has
      // a reply. ASC's customerReviews API doesn't surface PENDING_PUBLISH replies,
      // and pagination quirks can briefly drop responses from the include array, so
      // a missing response in the payload is *not* a signal to wipe — it's the
      // absence of a signal. ASC-side deletions reflect on the next sync that
      // *does* return the review with response data (or via the explicit DELETE
      // route handler). Owlmetry-originated PENDING replies stay intact.
      setWhere: sql`excluded.developer_response_id IS NOT NULL`,
    });

  const insertedReviews: AppStoreConnectReview[] = [];
  let reviewsUpdated = 0;

  for (const review of reviews) {
    const prior = existingByExtId.get(review.id);
    if (!prior) {
      insertedReviews.push(review);
      continue;
    }
    // setWhere gates the upsert so a payload without a response is a no-op —
    // don't count that as an "update," it's an unchanged duplicate.
    if (review.developer_response_id === null) continue;
    const priorAt = prior.developer_response_at?.getTime() ?? null;
    const newAt = review.developer_response_at?.getTime() ?? null;
    const responseChanged =
      prior.developer_response !== review.developer_response ||
      priorAt !== newAt ||
      prior.developer_response_id !== review.developer_response_id ||
      prior.developer_response_state !== review.developer_response_state;
    if (responseChanged) reviewsUpdated++;
  }

  return { insertedReviews, reviewsUpdated };
}

interface RefreshResult {
  refreshed: number;
  cleared: number;
  errors: number;
  rateLimitWaits: number;
  totalRateLimitWaitSeconds: number;
  errorStatusCounts: Record<string, number>;
  aborted: boolean;
  abortReason: string | null;
  pendingChecked: number;
}

// Per-row rate-limit retry cap — defends against a single stuck response
// burning the shared MAX_RATE_LIMIT_WAIT_SECONDS budget on its own.
const REFRESH_PER_ROW_RATE_LIMIT_RETRIES = 3;

async function refreshPendingResponses(
  ctx: JobContext,
  ascConfig: AppStoreConnectConfig,
  appId: string,
  startingTotalRateLimitWaitSeconds: number,
  maxRateLimitWaitSeconds: number,
): Promise<RefreshResult> {
  let refreshed = 0;
  let cleared = 0;
  let errors = 0;
  let rateLimitWaits = 0;
  let totalRateLimitWaitSeconds = startingTotalRateLimitWaitSeconds;
  const errorStatusCounts: Record<string, number> = {};
  let aborted = false;
  let abortReason: string | null = null;
  let pendingChecked = 0;

  const candidates = await ctx.db
    .select({
      id: appStoreReviews.id,
      external_id: appStoreReviews.external_id,
      developer_response_id: appStoreReviews.developer_response_id,
      developer_response: appStoreReviews.developer_response,
      developer_response_at: appStoreReviews.developer_response_at,
    })
    .from(appStoreReviews)
    .where(
      and(
        eq(appStoreReviews.app_id, appId),
        eq(appStoreReviews.store, APP_STORE),
        eq(appStoreReviews.developer_response_state, "PENDING_PUBLISH"),
        isNotNull(appStoreReviews.developer_response_id),
      ),
    );

  if (candidates.length === 0) {
    return {
      refreshed,
      cleared,
      errors,
      rateLimitWaits,
      totalRateLimitWaitSeconds,
      errorStatusCounts,
      aborted,
      abortReason,
      pendingChecked,
    };
  }

  ctx.log.info(
    { app_id: appId, pending_count: candidates.length },
    "Starting PENDING_PUBLISH refresh pass",
  );

  for (const candidate of candidates) {
    if (ctx.isCancelled()) {
      aborted = true;
      abortReason = "cancelled during refresh pass";
      break;
    }
    const responseId = candidate.developer_response_id;
    if (!responseId) continue;
    pendingChecked++;

    let retryAttempts = 0;
    let resolved = false;
    while (!resolved) {
      if (ctx.isCancelled()) {
        aborted = true;
        abortReason = "cancelled during refresh pass";
        resolved = true;
        break;
      }
      const result = await fetchCustomerReviewResponse(ascConfig, responseId);

      if (result.status === "auth_error") {
        aborted = true;
        abortReason = `auth_error during refresh: ${result.message}`;
        resolved = true;
        break;
      }
      if (result.status === "rate_limited") {
        rateLimitWaits++;
        if (totalRateLimitWaitSeconds + result.retryAfterSeconds > maxRateLimitWaitSeconds) {
          aborted = true;
          abortReason = `rate_limited: cumulative wait would exceed ${maxRateLimitWaitSeconds}s — bailing, next run will resume`;
          resolved = true;
          break;
        }
        if (retryAttempts >= REFRESH_PER_ROW_RATE_LIMIT_RETRIES) {
          errors++;
          const key = `refresh_rate_limit_exhausted`;
          errorStatusCounts[key] = (errorStatusCounts[key] ?? 0) + 1;
          ctx.log.warn(
            { app_id: appId, response_id: responseId, retryAttempts },
            "Refresh per-row rate-limit retry budget exhausted",
          );
          resolved = true;
          break;
        }
        totalRateLimitWaitSeconds += result.retryAfterSeconds;
        ctx.log.warn(
          { app_id: appId, response_id: responseId, retryAfterSeconds: result.retryAfterSeconds },
          "App Store Connect rate-limited refresh, sleeping",
        );
        await new Promise((r) => setTimeout(r, result.retryAfterSeconds * 1000));
        retryAttempts++;
        continue;
      }
      if (result.status === "error") {
        errors++;
        const key = `refresh_error_${result.statusCode}`;
        errorStatusCounts[key] = (errorStatusCounts[key] ?? 0) + 1;
        ctx.log.warn(
          {
            app_id: appId,
            response_id: responseId,
            statusCode: result.statusCode,
            message: result.message,
          },
          "Failed to refresh review response state",
        );
        resolved = true;
        break;
      }
      if (result.status === "not_found") {
        await ctx.db
          .update(appStoreReviews)
          .set({
            developer_response: null,
            developer_response_at: null,
            developer_response_id: null,
            developer_response_state: null,
            responded_by_user_id: null,
            updated_at: sql`now()`,
          })
          .where(eq(appStoreReviews.id, candidate.id));
        cleared++;
        ctx.log.info(
          { app_id: appId, response_id: responseId, review_id: candidate.id },
          "Cleared developer response — Apple removed it externally",
        );
        resolved = true;
        break;
      }
      // result.status === "found"
      const apiState = result.data.state;
      const apiBody = result.data.body;
      const apiAt = result.data.last_modified_at;
      const stateChanged = apiState !== null && apiState !== "PENDING_PUBLISH";
      const bodyChanged = apiBody !== "" && apiBody !== candidate.developer_response;
      const priorAtMs = candidate.developer_response_at?.getTime() ?? null;
      const newAtMs = apiAt?.getTime() ?? null;
      const atChanged = newAtMs !== null && newAtMs !== priorAtMs;
      if (stateChanged || bodyChanged || atChanged) {
        await ctx.db
          .update(appStoreReviews)
          .set({
            ...(stateChanged ? { developer_response_state: apiState } : {}),
            ...(bodyChanged ? { developer_response: apiBody } : {}),
            ...(atChanged && apiAt ? { developer_response_at: apiAt } : {}),
            updated_at: sql`now()`,
          })
          .where(eq(appStoreReviews.id, candidate.id));
        if (stateChanged) {
          refreshed++;
          ctx.log.info(
            {
              app_id: appId,
              response_id: responseId,
              prior_state: "PENDING_PUBLISH",
              new_state: apiState,
            },
            "Refreshed review response state",
          );
        }
      }
      resolved = true;
    }
  }

  return {
    refreshed,
    cleared,
    errors,
    rateLimitWaits,
    totalRateLimitWaitSeconds,
    errorStatusCounts,
    aborted,
    abortReason,
    pendingChecked,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
