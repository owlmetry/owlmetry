import { eq, and, isNull } from "drizzle-orm";
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

  // `properties` is pulled in the same select so the per-field merge for
  // RC-backfilled attribution doesn't need a second roundtrip.
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

  await ctx.updateProgress({ processed: 0, total, message: "Starting sync..." });

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

    if ((i + 1) % 10 === 0 || i === users.length - 1) {
      await ctx.updateProgress({
        processed: i + 1,
        total,
        message: `Synced ${synced} (${active} active, ${inactive} inactive), ${notFound} not found, ${errors} errors`,
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

const AGGREGATE_FIELDS = [
  "total",
  "synced",
  "skipped",
  "active",
  "inactive",
  "not_found",
  "errors",
  "attribution_synced",
  "attribution_enriched_existing",
  "attribution_marked_organic",
  "attribution_skipped_no_asa",
  "revenue_filled",
  "revenue_skipped",
] as const;

export const revenuecatSyncHandler: JobHandler = async (ctx, params) => {
  const targetProjectId = typeof params.project_id === "string" ? params.project_id : null;

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

  const aggregate: Record<(typeof AGGREGATE_FIELDS)[number], number> = Object.fromEntries(
    AGGREGATE_FIELDS.map((k) => [k, 0]),
  ) as Record<(typeof AGGREGATE_FIELDS)[number], number>;
  let projectsProcessed = 0;
  let projectsFailed = 0;
  const projectsAborted: Array<{ project_id: string; reason: string }> = [];
  const projectsErrored: Array<{ project_id: string; message: string }> = [];

  await ctx.updateProgress({
    processed: 0,
    total: projectIds.length,
    message: `Starting fan-out across ${projectIds.length} project(s)...`,
  });

  for (let i = 0; i < projectIds.length; i++) {
    if (ctx.isCancelled()) {
      ctx.log.info(`RevenueCat fan-out cancelled at ${i}/${projectIds.length} projects`);
      break;
    }
    const projectId = projectIds[i];
    try {
      const result = await syncProject(ctx, projectId);
      projectsProcessed++;
      for (const k of AGGREGATE_FIELDS) {
        aggregate[k] += (result[k] as number) ?? 0;
      }
      if (result.aborted) {
        projectsAborted.push({ project_id: projectId, reason: result.abort_reason ?? "unknown" });
      }
    } catch (err) {
      projectsFailed++;
      const message = err instanceof Error ? err.message : String(err);
      projectsErrored.push({ project_id: projectId, message });
      ctx.log.warn({ err, projectId }, "RC sync project failed (continuing fan-out)");
    }
    await ctx.updateProgress({
      processed: i + 1,
      total: projectIds.length,
      message: `Synced ${projectsProcessed}/${projectIds.length} project(s), ${projectsFailed} failed`,
    });
  }

  const result: Record<string, unknown> = {
    projects_processed: projectsProcessed,
    projects_failed: projectsFailed,
    ...aggregate,
  };
  if (projectsAborted.length > 0) result.projects_aborted = projectsAborted;
  if (projectsErrored.length > 0) result.projects_errored = projectsErrored;

  // Silent on routine clean runs — RC fan-out is daily housekeeping; surfacing
  // every successful sweep would spam the system-jobs alert. Failures and
  // aborts still report (no `_silent` when those arrays are non-empty).
  if (projectsFailed === 0 && projectsAborted.length === 0 && aggregate.errors === 0) {
    result._silent = true;
  }

  return result;
};
