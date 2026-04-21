import { eq, and, isNull } from "drizzle-orm";
import { projectIntegrations, appUsers } from "@owlmetry/db";
import { ATTRIBUTION_SOURCE_PROPERTY } from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";
import { mergeUserProperties } from "../utils/user-properties.js";
import { mapRevenueCatAttributesToAttributionProperties } from "../utils/attribution/revenuecat.js";
import {
  type RevenueCatConfig,
  mapSubscriberToProperties,
  fetchRevenueCatSubscriber,
  fetchRevenueCatSubscriptions,
  fetchRevenueCatCustomerAttributes,
  fetchRevenueCatProjectId,
} from "../utils/revenuecat.js";

export const revenuecatSyncHandler: JobHandler = async (ctx, params) => {
  const projectId = params.project_id as string;

  if (!projectId) {
    throw new Error("project_id is required");
  }

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
    return { synced: 0, total: 0, skipped: 0 };
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
      { statusCode, message },
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
      aborted: true,
      abort_reason: reason,
    };
  }
  const rcProjectId = projectIdResult.projectId;

  const MAX_USER_IDS = 10;
  const total = users.length;
  let synced = 0;
  let notFound = 0;
  let errors = 0;
  let active = 0;
  let inactive = 0;
  // Attribution-specific counters — separate from subscription sync so we can
  // see at a glance how much of the backfill actually landed.
  let attributionSynced = 0;
  let attributionEnrichedExisting = 0;
  let attributionSkippedNoAsa = 0;
  const notFoundUsers: string[] = [];
  const errorUsers: string[] = [];
  const errorStatusCounts: Record<string, number> = {};

  function recordErrorStatus(statusCode: number | undefined) {
    const key = statusCode !== undefined ? String(statusCode) : "network";
    errorStatusCounts[key] = (errorStatusCounts[key] ?? 0) + 1;
  }

  function buildResult(extra?: Record<string, unknown>) {
    const result: Record<string, unknown> = {
      total,
      synced,
      skipped: notFound + errors,
      active,
      inactive,
      not_found: notFound,
      errors,
      attribution_synced: attributionSynced,
      attribution_enriched_existing: attributionEnrichedExisting,
      attribution_skipped_no_asa: attributionSkippedNoAsa,
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
      ctx.log.info(`RevenueCat sync cancelled at ${i}/${total}`);
      return buildResult({ cancelled_at: i });
    }

    const user = users[i];
    try {
      const result = await fetchRevenueCatSubscriber(rcConfig.api_key, rcProjectId, user.user_id);
      if (result.status === "found") {
        // Fail-soft: if /subscriptions errors, we still sync the entitlements data.
        const subsResult = await fetchRevenueCatSubscriptions(rcConfig.api_key, rcProjectId, user.user_id);
        const subsData = subsResult.status === "found" ? subsResult.data : undefined;
        if (subsResult.status === "error") {
          ctx.log.warn(
            { userId: user.user_id, statusCode: subsResult.statusCode, message: subsResult.message },
            "RC subscriptions fetch failed (continuing with entitlements-only props)",
          );
        }

        // Fail-soft: attribution backfill via RC subscriber attributes
        // (`$mediaSource`, `$campaign`, `$adGroup`, `$keyword`). Fills slots
        // that Apple's live AdServices flow can't populate — names and the
        // literal search term — while never overwriting anything already set.
        const attrsResult = await fetchRevenueCatCustomerAttributes(
          rcConfig.api_key,
          rcProjectId,
          user.user_id,
        );
        let attributionProps: Record<string, string> = {};
        if (attrsResult.status === "found") {
          const mapped = mapRevenueCatAttributesToAttributionProperties(attrsResult.attributes);
          if (Object.keys(mapped).length === 0) {
            attributionSkippedNoAsa++;
          } else {
            const currentProps = (user.properties ?? {}) as Record<string, unknown>;
            attributionProps = Object.fromEntries(
              Object.entries(mapped).filter(([key]) => {
                const existing = currentProps[key];
                return existing === undefined || existing === null || existing === "";
              }),
            );
            if (Object.keys(attributionProps).length > 0) {
              if (currentProps[ATTRIBUTION_SOURCE_PROPERTY] !== undefined) {
                attributionEnrichedExisting++;
              } else {
                attributionSynced++;
              }
            }
          }
        } else if (attrsResult.status === "error") {
          ctx.log.warn(
            { userId: user.user_id, statusCode: attrsResult.statusCode, message: attrsResult.message },
            "RC attributes fetch failed (continuing without attribution backfill)",
          );
        }

        const subscriberProps = mapSubscriberToProperties(result.data, subsData);
        await mergeUserProperties(ctx.db, projectId, user.user_id, {
          ...subscriberProps,
          ...attributionProps,
        });
        synced++;
        if (subscriberProps.rc_status === "active") {
          active++;
        } else {
          inactive++;
        }
      } else if (result.status === "not_found") {
        notFound++;
        if (notFoundUsers.length < MAX_USER_IDS) notFoundUsers.push(user.user_id);
      } else {
        errors++;
        if (errorUsers.length < MAX_USER_IDS) errorUsers.push(user.user_id);
        recordErrorStatus(result.statusCode);
        ctx.log.warn(
          { userId: user.user_id, statusCode: result.statusCode, message: result.message },
          "RC sync error for user",
        );
        // Auth failures are systemic — every subsequent call will fail the same way.
        // Abort early instead of burning 350ms/user on a misconfigured key.
        if (result.statusCode === 401 || result.statusCode === 403) {
          ctx.log.error(
            { statusCode: result.statusCode, message: result.message },
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
      ctx.log.warn({ err, userId: user.user_id }, "RC sync failed for user");
      errors++;
      if (errorUsers.length < MAX_USER_IDS) errorUsers.push(user.user_id);
      recordErrorStatus(undefined);
    }

    // Update progress every 10 users
    if ((i + 1) % 10 === 0 || i === users.length - 1) {
      await ctx.updateProgress({
        processed: i + 1,
        total,
        message: `Synced ${synced} (${active} active, ${inactive} inactive), ${notFound} not found, ${errors} errors`,
      });
    }
  }

  ctx.log.info(
    `RevenueCat sync complete: ${synced}/${total} synced (${active} active, ${inactive} inactive), ` +
    `${notFound} not found, ${errors} errors. Attribution: ${attributionSynced} filled, ` +
    `${attributionEnrichedExisting} enriched, ${attributionSkippedNoAsa} non-ASA.`,
  );
  return buildResult();
};
