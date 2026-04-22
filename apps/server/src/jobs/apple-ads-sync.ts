import { eq, and, isNull } from "drizzle-orm";
import { projectIntegrations, appUsers } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";
import { mergeUserProperties, selectUnsetProps } from "../utils/user-properties.js";
import { enrichAppleAdsNames } from "../utils/apple-ads/enrich.js";
import type { AppleAdsConfig } from "../utils/apple-ads/config.js";

/**
 * Sweeps every user in the project that has a stored `asa_campaign_id` and
 * asks Apple's Campaign Management API for the human-readable name, plus ad
 * group / keyword / ad names when those IDs are present. Complements the
 * fire-and-forget enrichment done on the attribution route so users who were
 * attributed before the integration was connected get backfilled.
 *
 * Mirrors the shape of revenuecat_sync for operational consistency. On auth
 * failure (bad credentials, revoked key) aborts early — every subsequent call
 * would fail the same way.
 */
export const appleAdsSyncHandler: JobHandler = async (ctx, params) => {
  const projectId = params.project_id as string;

  if (!projectId) {
    throw new Error("project_id is required");
  }

  const [integration] = await ctx.db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.project_id, projectId),
        eq(projectIntegrations.provider, "apple-search-ads"),
        isNull(projectIntegrations.deleted_at),
        eq(projectIntegrations.enabled, true),
      ),
    )
    .limit(1);

  if (!integration) {
    throw new Error("Apple Search Ads integration not found or disabled");
  }

  const adsConfig = integration.config as unknown as AppleAdsConfig;

  const users = await ctx.db
    .select({
      user_id: appUsers.user_id,
      properties: appUsers.properties,
    })
    .from(appUsers)
    .where(eq(appUsers.project_id, projectId));

  const total = users.length;
  let examined = 0;
  let enriched = 0;
  let skippedNoIds = 0;
  let skippedAllNamesPresent = 0;
  let skippedNoNewNames = 0;
  let errors = 0;
  const errorStatusCounts: Record<string, number> = {};

  if (total === 0) {
    return {
      total: 0,
      examined: 0,
      enriched: 0,
      skipped_no_ids: 0,
      skipped_all_names_present: 0,
      skipped_no_new_names: 0,
      errors: 0,
    };
  }

  await ctx.updateProgress({ processed: 0, total, message: "Starting Apple Ads sync..." });

  for (let i = 0; i < users.length; i++) {
    if (ctx.isCancelled()) {
      ctx.log.info(`Apple Ads sync cancelled at ${i}/${total}`);
      return {
        total,
        examined,
        enriched,
        skipped_no_ids: skippedNoIds,
        skipped_all_names_present: skippedAllNamesPresent,
        skipped_no_new_names: skippedNoNewNames,
        errors,
        cancelled_at: i,
      };
    }

    const user = users[i];
    const currentProps = (user.properties ?? {}) as Record<string, unknown>;

    if (!currentProps.asa_campaign_id) {
      skippedNoIds++;
      continue;
    }

    // If every slot that would come from the API is already set, don't waste
    // a round-trip. (campaign/ad_group/keyword/ad mapping to their name keys.)
    const nameKeysForIds = [
      ["asa_campaign_id", "asa_campaign_name"],
      ["asa_ad_group_id", "asa_ad_group_name"],
      ["asa_keyword_id", "asa_keyword"],
      ["asa_ad_id", "asa_ad_name"],
    ];
    const everyPresentIdHasName = nameKeysForIds.every(([idKey, nameKey]) => {
      const hasId = currentProps[idKey] !== undefined && currentProps[idKey] !== null && currentProps[idKey] !== "";
      const hasName = currentProps[nameKey] !== undefined && currentProps[nameKey] !== null && currentProps[nameKey] !== "";
      return !hasId || hasName;
    });
    if (everyPresentIdHasName) {
      skippedAllNamesPresent++;
      continue;
    }

    examined++;

    try {
      const outcome = await enrichAppleAdsNames(adsConfig, currentProps);

      if (outcome.authError) {
        ctx.log.error(
          { message: outcome.authError },
          "Apple Ads sync aborting — auth error",
        );
        return {
          total,
          examined,
          enriched,
          skipped_no_ids: skippedNoIds,
          skipped_all_names_present: skippedAllNamesPresent,
          skipped_no_new_names: skippedNoNewNames,
          errors,
          aborted: true,
          abort_reason: `Apple Ads API rejected the credentials: ${outcome.authError}`,
        };
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
      if (Object.keys(unsetProps).length === 0) {
        skippedNoNewNames++;
      } else {
        await mergeUserProperties(ctx.db, projectId, user.user_id, unsetProps);
        enriched++;
      }
    } catch (err) {
      errors++;
      ctx.log.warn({ err, userId: user.user_id }, "Apple Ads enrichment failed for user");
    }

    // Light throttle — generous Apple rate limits, but don't hammer.
    await new Promise((r) => setTimeout(r, 100));

    if ((i + 1) % 10 === 0 || i === users.length - 1) {
      await ctx.updateProgress({
        processed: i + 1,
        total,
        message: `Examined ${examined}, enriched ${enriched}, ${errors} field errors`,
      });
    }
  }

  const result: Record<string, unknown> = {
    total,
    examined,
    enriched,
    skipped_no_ids: skippedNoIds,
    skipped_all_names_present: skippedAllNamesPresent,
    skipped_no_new_names: skippedNoNewNames,
    errors,
  };
  if (Object.keys(errorStatusCounts).length > 0) {
    result.error_status_counts = errorStatusCounts;
  }

  ctx.log.info(
    `Apple Ads sync complete: ${enriched}/${examined} enriched (of ${total} users), ` +
    `${skippedNoIds} no-ids, ${skippedAllNamesPresent} all-names-present, ` +
    `${skippedNoNewNames} no-new-names, ${errors} field errors.`,
  );
  return result;
};
