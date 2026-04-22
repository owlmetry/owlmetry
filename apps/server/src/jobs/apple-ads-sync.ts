import { eq, and, sql } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import { ASA_ID_NAME_PAIRS } from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";
import { mergeUserProperties, selectUnsetProps } from "../utils/user-properties.js";
import { findActiveIntegration } from "../utils/integrations.js";
import { AppleAdsLookupCache, enrichAppleAdsNames, buildEnrichmentDiagnostic } from "../utils/apple-ads/enrich.js";
import type { AppleAdsConfig } from "../utils/apple-ads/config.js";

/**
 * Sweeps every user in the project that has a stored `asa_campaign_id` and
 * asks Apple's Campaign Management API for the human-readable name, plus ad
 * group / keyword / ad names when those IDs are present. Complements the
 * fire-and-forget enrichment done on the attribution route so users who were
 * attributed before the integration was connected get backfilled.
 *
 * Uses a per-run cache so N users attributed to the same campaign collapse
 * into one API call each for campaign/adgroup/keyword/ad. On auth failure
 * (bad credentials, revoked key) aborts early — every subsequent call would
 * fail the same way.
 */
export const appleAdsSyncHandler: JobHandler = async (ctx, params) => {
  const projectId = params.project_id as string;

  if (!projectId) {
    throw new Error("project_id is required");
  }

  const integration = await findActiveIntegration(ctx.db, projectId, "apple-search-ads");
  if (!integration) {
    throw new Error("Apple Search Ads integration not found or disabled");
  }

  const adsConfig = integration.config as unknown as AppleAdsConfig;

  // Push the "has an asa_campaign_id" predicate into Postgres so we only pull
  // rows that could possibly need enrichment. Matches the RevenueCat sync's
  // approach of minimizing wire traffic on large projects.
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

  const total = users.length;
  let examined = 0;
  let enriched = 0;
  let skippedAllNamesPresent = 0;
  let skippedNoNewNames = 0;
  let errors = 0;
  const errorStatusCounts: Record<string, number> = {};
  const cache = new AppleAdsLookupCache();

  function buildResult(extra?: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {
      total,
      examined,
      enriched,
      skipped_all_names_present: skippedAllNamesPresent,
      skipped_no_new_names: skippedNoNewNames,
      errors,
      ...extra,
    };
    if (Object.keys(errorStatusCounts).length > 0) {
      result.error_status_counts = errorStatusCounts;
    }
    return result;
  }

  if (total === 0) {
    return buildResult();
  }

  await ctx.updateProgress({ processed: 0, total, message: "Starting Apple Ads sync..." });

  for (let i = 0; i < users.length; i++) {
    if (ctx.isCancelled()) {
      ctx.log.info(`Apple Ads sync cancelled at ${i}/${total}`);
      return buildResult({ cancelled_at: i });
    }

    const user = users[i];
    const currentProps = (user.properties ?? {}) as Record<string, unknown>;

    if (allIdsAlreadyResolved(currentProps)) {
      skippedAllNamesPresent++;
      continue;
    }

    examined++;

    try {
      const outcome = await enrichAppleAdsNames(adsConfig, currentProps, cache);

      if (outcome.authError) {
        ctx.log.error(
          { message: outcome.authError },
          "Apple Ads sync aborting — auth error",
        );
        // Stamp the current user before returning so at least one user reflects
        // the failure. The remaining users keep their previous diagnostic.
        const diagnostic = buildEnrichmentDiagnostic(outcome, 0);
        await mergeUserProperties(ctx.db, projectId, user.user_id, diagnostic);
        return buildResult({
          aborted: true,
          abort_reason: `Apple Ads API rejected the credentials: ${outcome.authError}`,
        });
      }

      for (const fe of outcome.fieldErrors) {
        errors++;
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
        skippedNoNewNames++;
      } else {
        enriched++;
      }
    } catch (err) {
      errors++;
      ctx.log.warn({ err, userId: user.user_id }, "Apple Ads enrichment failed for user");
    }

    if ((i + 1) % 10 === 0 || i === users.length - 1) {
      await ctx.updateProgress({
        processed: i + 1,
        total,
        message: `Examined ${examined}, enriched ${enriched}, ${errors} field errors`,
      });
    }
  }

  ctx.log.info(
    `Apple Ads sync complete: ${enriched}/${examined} enriched (of ${total} users), ` +
    `${skippedAllNamesPresent} all-names-present, ${skippedNoNewNames} no-new-names, ` +
    `${errors} field errors.`,
  );
  return buildResult();
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
