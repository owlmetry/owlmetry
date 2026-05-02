import { eq, and, isNull, sql } from "drizzle-orm";
import { appUsers, projectIntegrations, projects } from "@owlmetry/db";
import { ASA_ID_NAME_PAIRS } from "@owlmetry/shared";
import type { JobContext, JobHandler } from "../services/job-runner.js";
import { mergeUserProperties, selectUnsetProps } from "../utils/user-properties.js";
import { findActiveIntegration } from "../utils/integrations.js";
import { AppleAdsLookupCache, enrichAppleAdsNames, buildEnrichmentDiagnostic } from "../utils/apple-ads/enrich.js";
import { syncAppleAdsMetrics, type MetricsSyncResult } from "../utils/apple-ads/metrics.js";
import type { AppleAdsConfig } from "../utils/apple-ads/config.js";

/**
 * Apple Search Ads sync — runs two passes per project:
 *
 *   1. **Names pass**: sweeps every user with a stored `asa_campaign_id` and
 *      back-fills human-readable names via Campaign Management GETs.
 *      Complements the fire-and-forget enrichment done on the attribution
 *      route so users attributed before the integration was connected get
 *      caught up.
 *   2. **Metrics pass**: pulls campaign + ad-group spend reports from the
 *      Reports API and upserts `ad_campaign_lifetime` / `ad_adgroup_lifetime`,
 *      filtered by `adamId` ↔ `apps.apple_app_store_id` so a project only
 *      stores metrics for its own apps. Powers the spend + ROAS columns on
 *      `/dashboard/ads`.
 *
 * **Routing**: with `params.project_id` set we run both passes for that
 * single project (manual-trigger path from `POST /v1/projects/:id/ads/sync`).
 * With no `project_id` we fan out across every project that has an active
 * `apple-search-ads` integration — daily schedule. Per-project try/catch
 * isolates failures so one bad credential set doesn't poison the rest of the
 * sweep, mirroring the `revenuecat_sync` and `app_store_connect_reviews_sync`
 * jobs. Auth errors short-circuit the project (every subsequent call would
 * fail the same way) but are reported, not thrown.
 */

type ProjectSyncResult = {
  total: number;
  examined: number;
  enriched: number;
  skipped_all_names_present: number;
  skipped_no_new_names: number;
  errors: number;
  campaigns_seen: number;
  campaigns_matched: number;
  campaigns_upserted: number;
  ad_groups_upserted: number;
  currency_warning?: string;
  aborted?: boolean;
  abort_reason?: string;
  cancelled_at?: number;
  error_status_counts?: Record<string, number>;
} & Record<string, unknown>;

const AGGREGATE_FIELDS = [
  "total",
  "examined",
  "enriched",
  "skipped_all_names_present",
  "skipped_no_new_names",
  "errors",
  "campaigns_seen",
  "campaigns_matched",
  "campaigns_upserted",
  "ad_groups_upserted",
] as const;

async function syncProject(ctx: JobContext, projectId: string): Promise<ProjectSyncResult> {
  const integration = await findActiveIntegration(ctx.db, projectId, "apple-search-ads");
  if (!integration) {
    throw new Error("Apple Search Ads integration not found or disabled");
  }

  const adsConfig = integration.config as unknown as AppleAdsConfig;
  const cache = new AppleAdsLookupCache();

  // Resolve team_id once — both passes need it (metrics for FK, names for
  // diagnostics). Cheaper than threading it through every helper signature.
  const [project] = await ctx.db
    .select({ team_id: projects.team_id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const result: ProjectSyncResult = {
    total: 0,
    examined: 0,
    enriched: 0,
    skipped_all_names_present: 0,
    skipped_no_new_names: 0,
    errors: 0,
    campaigns_seen: 0,
    campaigns_matched: 0,
    campaigns_upserted: 0,
    ad_groups_upserted: 0,
  };
  const errorStatusCounts: Record<string, number> = {};

  // --- Pass 1: per-user name enrichment -----------------------------------
  const users = await ctx.db
    .select({
      user_id: appUsers.user_id,
      properties: appUsers.properties,
    })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.project_id, projectId),
        sql`${appUsers.properties} ? 'asa_campaign_id'`,
      ),
    );

  result.total = users.length;
  if (users.length > 0) {
    await ctx.updateProgress({ processed: 0, total: users.length, message: "Resolving Apple Ads names..." });
  }

  for (let i = 0; i < users.length; i++) {
    if (ctx.isCancelled()) {
      ctx.log.info(`Apple Ads sync cancelled at ${i}/${users.length}`);
      result.cancelled_at = i;
      if (Object.keys(errorStatusCounts).length > 0) result.error_status_counts = errorStatusCounts;
      return result;
    }

    const user = users[i];
    const currentProps = (user.properties ?? {}) as Record<string, unknown>;

    if (allIdsAlreadyResolved(currentProps)) {
      result.skipped_all_names_present++;
      continue;
    }

    result.examined++;

    try {
      const outcome = await enrichAppleAdsNames(adsConfig, currentProps, cache);

      if (outcome.authError) {
        ctx.log.error(
          { message: outcome.authError },
          "Apple Ads sync aborting — auth error",
        );
        const diagnostic = buildEnrichmentDiagnostic(outcome, 0);
        await mergeUserProperties(ctx.db, projectId, user.user_id, diagnostic);
        result.aborted = true;
        result.abort_reason = `Apple Ads API rejected the credentials: ${outcome.authError}`;
        if (Object.keys(errorStatusCounts).length > 0) result.error_status_counts = errorStatusCounts;
        return result;
      }

      for (const fe of outcome.fieldErrors) {
        result.errors++;
        const key = String(fe.statusCode);
        errorStatusCounts[key] = (errorStatusCounts[key] ?? 0) + 1;
        ctx.log.warn(
          { userId: user.user_id, field: fe.field, statusCode: fe.statusCode, message: fe.message },
          "Apple Ads field lookup failed (continuing)",
        );
      }

      const unsetProps = selectUnsetProps(outcome.props, currentProps);
      const diagnostic = buildEnrichmentDiagnostic(outcome, Object.keys(unsetProps).length);
      await mergeUserProperties(ctx.db, projectId, user.user_id, { ...unsetProps, ...diagnostic });
      if (Object.keys(unsetProps).length === 0) {
        result.skipped_no_new_names++;
      } else {
        result.enriched++;
      }
    } catch (err) {
      result.errors++;
      ctx.log.warn({ err, userId: user.user_id }, "Apple Ads enrichment failed for user");
    }

    if ((i + 1) % 10 === 0 || i === users.length - 1) {
      await ctx.updateProgress({
        processed: i + 1,
        total: users.length,
        message: `Examined ${result.examined}, enriched ${result.enriched}, ${result.errors} field errors`,
      });
    }
  }

  // --- Pass 2: campaign + ad-group spend rollup ---------------------------
  // Names pass is a strict prerequisite — it acts as the auth gate. If we got
  // here without `result.aborted`, credentials are valid and the report calls
  // are worth the API budget.
  await ctx.updateProgress({
    processed: 0,
    total: 1,
    message: "Pulling Apple Ads spend reports...",
  });
  const metricsResult: MetricsSyncResult = await syncAppleAdsMetrics(
    ctx.db,
    project.team_id,
    projectId,
    adsConfig,
    cache,
  );
  result.campaigns_seen = metricsResult.campaigns_seen;
  result.campaigns_matched = metricsResult.campaigns_matched;
  result.campaigns_upserted = metricsResult.campaigns_upserted;
  result.ad_groups_upserted = metricsResult.ad_groups_upserted;
  if (metricsResult.currency_warning) result.currency_warning = metricsResult.currency_warning;
  for (const [code, count] of Object.entries(metricsResult.error_status_counts)) {
    errorStatusCounts[code] = (errorStatusCounts[code] ?? 0) + count;
  }
  if (metricsResult.auth_error) {
    result.aborted = true;
    result.abort_reason = `Apple Ads Reports API rejected the credentials: ${metricsResult.auth_error}`;
  }

  ctx.log.info(
    `Apple Ads sync: enriched ${result.enriched}/${result.examined} users (${result.total} total); ` +
    `${result.campaigns_upserted}/${result.campaigns_matched} campaigns + ${result.ad_groups_upserted} ad groups upserted ` +
    `(${result.campaigns_seen} seen org-wide); ${result.errors} field errors.`,
  );

  if (Object.keys(errorStatusCounts).length > 0) result.error_status_counts = errorStatusCounts;
  return result;
}

export const appleAdsSyncHandler: JobHandler = async (ctx, params) => {
  const targetProjectId = typeof params.project_id === "string" ? params.project_id : null;

  if (targetProjectId) {
    return await syncProject(ctx, targetProjectId);
  }

  // Fan-out mode (daily schedule). Per-project try/catch isolates failures.
  const integrations = await ctx.db
    .select({ project_id: projectIntegrations.project_id })
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.provider, "apple-search-ads"),
        isNull(projectIntegrations.deleted_at),
        eq(projectIntegrations.enabled, true),
      ),
    );

  const projectIds = [...new Set(integrations.map((i) => i.project_id))];
  if (projectIds.length === 0) {
    return { projects_processed: 0, _silent: true };
  }

  const aggregate: Record<(typeof AGGREGATE_FIELDS)[number], number> = Object.fromEntries(
    AGGREGATE_FIELDS.map((k) => [k, 0]),
  ) as Record<(typeof AGGREGATE_FIELDS)[number], number>;
  let projectsProcessed = 0;
  let projectsFailed = 0;
  const projectsAborted: Array<{ project_id: string; reason: string }> = [];
  const projectsErrored: Array<{ project_id: string; message: string }> = [];
  const errorStatusCounts: Record<string, number> = {};
  const currencyWarnings = new Set<string>();

  await ctx.updateProgress({
    processed: 0,
    total: projectIds.length,
    message: `Starting fan-out across ${projectIds.length} project(s)...`,
  });

  for (let i = 0; i < projectIds.length; i++) {
    if (ctx.isCancelled()) {
      ctx.log.info(`Apple Ads fan-out cancelled at ${i}/${projectIds.length} projects`);
      break;
    }
    const projectId = projectIds[i];
    try {
      const r = await syncProject(ctx, projectId);
      projectsProcessed++;
      for (const k of AGGREGATE_FIELDS) {
        aggregate[k] += (r[k] as number) ?? 0;
      }
      if (r.aborted) {
        projectsAborted.push({ project_id: projectId, reason: r.abort_reason ?? "unknown" });
      }
      if (r.currency_warning) currencyWarnings.add(r.currency_warning);
      if (r.error_status_counts) {
        for (const [code, count] of Object.entries(r.error_status_counts)) {
          errorStatusCounts[code] = (errorStatusCounts[code] ?? 0) + count;
        }
      }
    } catch (err) {
      projectsFailed++;
      const message = err instanceof Error ? err.message : String(err);
      projectsErrored.push({ project_id: projectId, message });
      ctx.log.warn({ err, projectId }, "Apple Ads sync project failed (continuing fan-out)");
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
  if (currencyWarnings.size > 0) result.currency_warnings = [...currencyWarnings];
  if (Object.keys(errorStatusCounts).length > 0) result.error_status_counts = errorStatusCounts;

  // Silent on a clean fan-out — daily housekeeping shouldn't ping the system
  // alert email when nothing went wrong.
  if (
    projectsFailed === 0 &&
    projectsAborted.length === 0 &&
    aggregate.errors === 0 &&
    Object.keys(errorStatusCounts).length === 0
  ) {
    result._silent = true;
  }
  return result;
};

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

// True when every present `asa_*_id` already has a matching `asa_*_name` in
// the stored props — nothing for the API to resolve, skip the round-trip.
function allIdsAlreadyResolved(props: Record<string, unknown>): boolean {
  return ASA_ID_NAME_PAIRS.every(({ idKey, nameKey }) =>
    !hasValue(props[idKey]) || hasValue(props[nameKey]),
  );
}
