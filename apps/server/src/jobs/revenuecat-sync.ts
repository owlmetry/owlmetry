import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { projectIntegrations, appUsers } from "@owlmetry/db";
import type { JobContext, JobHandler } from "../services/job-runner.js";
import {
  type RevenueCatConfig,
  fetchRevenueCatProjectId,
} from "../utils/revenuecat.js";
import { syncRevenueCatUserProperties } from "../utils/revenuecat-user-sync.js";

const MAX_USER_IDS = 10;

type ProjectSyncResult = {
  total: number;
  synced: number;
  skipped: number;
  active: number;
  inactive: number;
  not_found: number;
  errors: number;
  attribution_synced: number;
  attribution_enriched_existing: number;
  attribution_marked_organic: number;
  attribution_skipped_no_asa: number;
  revenue_filled: number;
  revenue_skipped: number;
  not_found_users?: string[];
  error_users?: string[];
  error_status_counts?: Record<string, number>;
  aborted?: boolean;
  abort_reason?: string;
  cancelled_at?: number;
} & Record<string, unknown>;

/**
 * Sync a single project against the RevenueCat V2 API. Iterates non-anonymous
 * users, calls `syncRevenueCatUserProperties` per user, returns aggregated
 * counters. Auth failures abort early so a misconfigured key doesn't burn
 * 350ms/user across the project; the abort surfaces as `aborted: true` with
 * a human-readable reason.
 *
 * In fan-out mode the wrapper isolates per-project failures in try/catch — one
 * bad integration won't stop the rest.
 */
async function syncProject(
  ctx: JobContext,
  projectId: string,
  options: { progressBaseline?: { processed: number; total: number; label: string } } = {},
): Promise<ProjectSyncResult> {
  // Look up the active RevenueCat integration for this project
  const [integration] = await ctx.db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.project_id, projectId),
        eq(projectIntegrations.provider, "revenuecat"),
        isNull(projectIntegrations.deleted_at),
        eq(projectIntegrations.enabled, true),
      ),
    )
    .limit(1);

  if (!integration) {
    throw new Error("RevenueCat integration not found or disabled");
  }

  const rcConfig = integration.config as unknown as RevenueCatConfig;

  // Get all non-anonymous users in the project. `properties` is pulled so
  // we can apply the per-field merge for RC-backfilled attribution without
  // a second round-trip.
  const users = await ctx.db
    .select({
      id: appUsers.id,
      user_id: appUsers.user_id,
      properties: appUsers.properties,
    })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.project_id, projectId),
        eq(appUsers.is_anonymous, false),
      ),
    );

  if (users.length === 0) {
    return {
      total: 0,
      synced: 0,
      skipped: 0,
      active: 0,
      inactive: 0,
      not_found: 0,
      errors: 0,
      attribution_synced: 0,
      attribution_enriched_existing: 0,
      attribution_marked_organic: 0,
      attribution_skipped_no_asa: 0,
      revenue_filled: 0,
      revenue_skipped: 0,
    };
  }

  // Resolve the RevenueCat project ID for this API key. V2 endpoints are
  // project-scoped, so every per-user call needs this in the URL.
  const projectIdResult = await fetchRevenueCatProjectId(rcConfig.api_key);
  if (projectIdResult.status !== "found") {
    const statusCode = projectIdResult.status === "error" ? projectIdResult.statusCode : undefined;
    const message = projectIdResult.status === "error" ? projectIdResult.message : undefined;
    const reason = projectIdResult.status === "no_projects"
      ? "RevenueCat API key has no accessible projects. Generate a project-scoped V2 secret key in RevenueCat → Project Settings → API Keys."
      : `RevenueCat API error while resolving project: HTTP ${statusCode ?? "network"} — ${message ?? "no response body"}`;
    ctx.log.error(
      { projectId, statusCode, message },
      "RC sync aborting — could not resolve RevenueCat project",
    );
    return {
      total: users.length,
      synced: 0,
      skipped: 0,
      errors: 0,
      not_found: 0,
      active: 0,
      inactive: 0,
      attribution_synced: 0,
      attribution_enriched_existing: 0,
      attribution_marked_organic: 0,
      attribution_skipped_no_asa: 0,
      revenue_filled: 0,
      revenue_skipped: 0,
      aborted: true,
      abort_reason: reason,
    };
  }
  const rcProjectId = projectIdResult.projectId;

  const total = users.length;
  let synced = 0;
  let notFound = 0;
  let errors = 0;
  let active = 0;
  let inactive = 0;
  let attributionSynced = 0;
  let attributionEnrichedExisting = 0;
  let attributionMarkedOrganic = 0;
  let attributionSkippedNoAsa = 0;
  let revenueFilled = 0;
  let revenueSkipped = 0;
  const notFoundUsers: string[] = [];
  const errorUsers: string[] = [];
  const errorStatusCounts: Record<string, number> = {};

  function recordErrorStatus(statusCode: number | undefined) {
    const key = statusCode !== undefined ? String(statusCode) : "network";
    errorStatusCounts[key] = (errorStatusCounts[key] ?? 0) + 1;
  }

  function buildResult(extra?: Partial<ProjectSyncResult>): ProjectSyncResult {
    const result: ProjectSyncResult = {
      total,
      synced,
      skipped: notFound + errors,
      active,
      inactive,
      not_found: notFound,
      errors,
      attribution_synced: attributionSynced,
      attribution_enriched_existing: attributionEnrichedExisting,
      attribution_marked_organic: attributionMarkedOrganic,
      attribution_skipped_no_asa: attributionSkippedNoAsa,
      revenue_filled: revenueFilled,
      revenue_skipped: revenueSkipped,
      ...extra,
    };
    if (notFoundUsers.length > 0) {
      result.not_found_users = notFound > MAX_USER_IDS
        ? [...notFoundUsers, `...and ${notFound - MAX_USER_IDS} more`]
        : notFoundUsers;
    }
    if (errorUsers.length > 0) {
      result.error_users = errors > MAX_USER_IDS
        ? [...errorUsers, `...and ${errors - MAX_USER_IDS} more`]
        : errorUsers;
    }
    if (Object.keys(errorStatusCounts).length > 0) {
      result.error_status_counts = errorStatusCounts;
    }
    return result;
  }

  const baseline = options.progressBaseline;
  if (!baseline) {
    await ctx.updateProgress({ processed: 0, total, message: "Starting sync..." });
  }

  for (let i = 0; i < users.length; i++) {
    if (ctx.isCancelled()) {
      ctx.log.info(`RevenueCat sync cancelled at ${i}/${total} (project ${projectId})`);
      return buildResult({ cancelled_at: i });
    }

    const user = users[i];
    try {
      const result = await syncRevenueCatUserProperties({
        db: ctx.db,
        log: ctx.log,
        projectId,
        rcProjectId,
        config: rcConfig,
        userId: user.user_id,
        currentProps: (user.properties ?? {}) as Record<string, unknown>,
      });

      if (result.status === "synced") {
        synced++;
        if (result.isActive) active++;
        else inactive++;
        if (result.attribution.synced) attributionSynced++;
        if (result.attribution.enriched) attributionEnrichedExisting++;
        if (result.attribution.markedOrganic) attributionMarkedOrganic++;
        if (result.attribution.skippedNoAsa) attributionSkippedNoAsa++;
        if (result.revenue.usdCents !== null) revenueFilled++;
        else revenueSkipped++;
      } else if (result.status === "not_found") {
        notFound++;
        if (notFoundUsers.length < MAX_USER_IDS) notFoundUsers.push(user.user_id);
      } else {
        errors++;
        if (errorUsers.length < MAX_USER_IDS) errorUsers.push(user.user_id);
        recordErrorStatus(result.statusCode);
        ctx.log.warn(
          { projectId, userId: user.user_id, statusCode: result.statusCode, message: result.message },
          "RC sync error for user",
        );
        // Auth failures are systemic — every subsequent call will fail the same way.
        // Abort early instead of burning 350ms/user on a misconfigured key.
        if (result.statusCode === 401 || result.statusCode === 403) {
          ctx.log.error(
            { projectId, statusCode: result.statusCode, message: result.message },
            "RC sync aborting — RevenueCat rejected the API key",
          );
          return buildResult({
            aborted: true,
            abort_reason: `RevenueCat API rejected the key with HTTP ${result.statusCode}. Response: ${result.message ?? "(no body)"}`,
          });
        }
      }
      // Rate limit: ~3 requests per second (180/min)
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      ctx.log.warn({ err, projectId, userId: user.user_id }, "RC sync failed for user");
      errors++;
      if (errorUsers.length < MAX_USER_IDS) errorUsers.push(user.user_id);
      recordErrorStatus(undefined);
    }

    // Update progress every 10 users
    if ((i + 1) % 10 === 0 || i === users.length - 1) {
      const processed = (baseline?.processed ?? 0) + i + 1;
      const totalUsers = baseline?.total ?? total;
      const prefix = baseline?.label ? `${baseline.label} | ` : "";
      await ctx.updateProgress({
        processed,
        total: totalUsers,
        message: `${prefix}Synced ${synced} (${active} active, ${inactive} inactive), ${notFound} not found, ${errors} errors`,
      });
    }
  }

  ctx.log.info(
    `RC sync project ${projectId} complete: ${synced}/${total} synced (${active} active, ${inactive} inactive), ` +
    `${notFound} not found, ${errors} errors. Attribution: ${attributionSynced} filled, ` +
    `${attributionEnrichedExisting} enriched, ${attributionMarkedOrganic} marked organic, ` +
    `${attributionSkippedNoAsa} non-ASA. Revenue: ${revenueFilled} filled, ${revenueSkipped} skipped.`,
  );
  return buildResult();
}

/**
 * Pre-counts users per project so the fan-out can show a meaningful
 * processed/total in the progress bar (otherwise each project would reset
 * the bar to 0 of its own count and the operator can't see overall progress).
 */
async function countUsersAcrossProjects(
  ctx: JobContext,
  projectIds: string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({
      project_id: appUsers.project_id,
      count: sql<number>`COUNT(*)::int`.as("count"),
    })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.is_anonymous, false),
        inArray(appUsers.project_id, projectIds),
      ),
    )
    .groupBy(appUsers.project_id);
  const counts = new Map<string, number>();
  for (const id of projectIds) counts.set(id, 0);
  for (const row of rows) counts.set(row.project_id, row.count);
  return counts;
}

export const revenuecatSyncHandler: JobHandler = async (ctx, params) => {
  const targetProjectId = typeof params.project_id === "string" ? params.project_id : null;

  // Single-project mode (manual-trigger path). Throws on missing/disabled
  // integration so the dashboard's last-sync strip surfaces the error.
  if (targetProjectId) {
    return await syncProject(ctx, targetProjectId);
  }

  // Fan-out mode (daily schedule). Sweeps every project with an active RC
  // integration. Per-project failures are isolated so one misconfigured key
  // doesn't kill the run for everyone else.
  const integrations = await ctx.db
    .select({ project_id: projectIntegrations.project_id })
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.provider, "revenuecat"),
        isNull(projectIntegrations.deleted_at),
        eq(projectIntegrations.enabled, true),
      ),
    );

  const projectIds = [...new Set(integrations.map((i) => i.project_id))];
  if (projectIds.length === 0) {
    return { projects_processed: 0, total: 0, synced: 0, _silent: true };
  }

  const userCounts = await countUsersAcrossProjects(ctx, projectIds);
  const totalUsers = [...userCounts.values()].reduce((a, b) => a + b, 0);

  let processedSoFar = 0;
  let projectsProcessed = 0;
  let projectsFailed = 0;
  let aggSynced = 0;
  let aggSkipped = 0;
  let aggActive = 0;
  let aggInactive = 0;
  let aggNotFound = 0;
  let aggErrors = 0;
  let aggAttributionSynced = 0;
  let aggAttributionEnriched = 0;
  let aggAttributionOrganic = 0;
  let aggAttributionNoAsa = 0;
  let aggRevenueFilled = 0;
  let aggRevenueSkipped = 0;
  const projectsAborted: Array<{ project_id: string; reason: string }> = [];
  const projectsErrored: Array<{ project_id: string; message: string }> = [];

  await ctx.updateProgress({
    processed: 0,
    total: totalUsers,
    message: `Starting fan-out across ${projectIds.length} project(s)...`,
  });

  for (let i = 0; i < projectIds.length; i++) {
    if (ctx.isCancelled()) {
      ctx.log.info(`RevenueCat fan-out cancelled at ${i}/${projectIds.length} projects`);
      break;
    }
    const projectId = projectIds[i];
    const projectUserCount = userCounts.get(projectId) ?? 0;
    try {
      const result = await syncProject(ctx, projectId, {
        progressBaseline: {
          processed: processedSoFar,
          total: totalUsers,
          label: `Project ${i + 1}/${projectIds.length}`,
        },
      });
      projectsProcessed++;
      aggSynced += result.synced;
      aggSkipped += result.skipped;
      aggActive += result.active;
      aggInactive += result.inactive;
      aggNotFound += result.not_found;
      aggErrors += result.errors;
      aggAttributionSynced += result.attribution_synced;
      aggAttributionEnriched += result.attribution_enriched_existing;
      aggAttributionOrganic += result.attribution_marked_organic;
      aggAttributionNoAsa += result.attribution_skipped_no_asa;
      aggRevenueFilled += result.revenue_filled;
      aggRevenueSkipped += result.revenue_skipped;
      if (result.aborted) {
        projectsAborted.push({ project_id: projectId, reason: result.abort_reason ?? "unknown" });
      }
    } catch (err) {
      projectsFailed++;
      const message = err instanceof Error ? err.message : String(err);
      projectsErrored.push({ project_id: projectId, message });
      ctx.log.warn({ err, projectId }, "RC sync project failed (continuing fan-out)");
    } finally {
      processedSoFar += projectUserCount;
    }
  }

  const result: Record<string, unknown> = {
    projects_processed: projectsProcessed,
    projects_failed: projectsFailed,
    total: totalUsers,
    synced: aggSynced,
    skipped: aggSkipped,
    active: aggActive,
    inactive: aggInactive,
    not_found: aggNotFound,
    errors: aggErrors,
    attribution_synced: aggAttributionSynced,
    attribution_enriched_existing: aggAttributionEnriched,
    attribution_marked_organic: aggAttributionOrganic,
    attribution_skipped_no_asa: aggAttributionNoAsa,
    revenue_filled: aggRevenueFilled,
    revenue_skipped: aggRevenueSkipped,
  };
  if (projectsAborted.length > 0) result.projects_aborted = projectsAborted;
  if (projectsErrored.length > 0) result.projects_errored = projectsErrored;

  // Silent on routine clean runs — RC fan-out is daily housekeeping; surfacing
  // every successful sweep would spam the system-jobs alert. Failures and
  // aborts still report (no `_silent` when those arrays are non-empty).
  if (projectsFailed === 0 && projectsAborted.length === 0 && aggErrors === 0) {
    result._silent = true;
  }

  return result;
};
