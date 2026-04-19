import { eq, and, isNull } from "drizzle-orm";
import { projectIntegrations, appUsers } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";
import { mergeUserProperties } from "../utils/user-properties.js";
import {
  type RevenueCatConfig,
  mapSubscriberToProperties,
  fetchRevenueCatSubscriber,
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

  // Get all non-anonymous users in the project
  const users = await ctx.db
    .select({ id: appUsers.id, user_id: appUsers.user_id })
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

  const MAX_USER_IDS = 10;
  const total = users.length;
  let synced = 0;
  let notFound = 0;
  let errors = 0;
  let active = 0;
  let inactive = 0;
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
      const result = await fetchRevenueCatSubscriber(rcConfig.api_key, user.user_id);
      if (result.status === "found") {
        const props = mapSubscriberToProperties(result.data.subscriber);
        await mergeUserProperties(ctx.db, projectId, user.user_id, props);
        synced++;
        if (props.rc_status === "active") {
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
            "RC sync aborting — API key rejected (likely wrong key type; REST API requires a secret key starting with sk_)",
          );
          return buildResult({
            aborted: true,
            abort_reason: `RevenueCat API key rejected with HTTP ${result.statusCode}. The REST API requires a secret key (sk_*), not a platform SDK key (appl_*/goog_*).`,
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

  ctx.log.info(`RevenueCat sync complete: ${synced}/${total} synced (${active} active, ${inactive} inactive), ${notFound} not found, ${errors} errors`);
  return buildResult();
};
