import { eq, and, isNull, inArray } from "drizzle-orm";
import { projectIntegrations, apps, appUsers } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";
import { mergeUserProperties } from "../utils/user-properties.js";

interface RevenueCatConfig {
  api_key: string;
  webhook_secret: string;
}

interface RevenueCatSubscriberResponse {
  request_date: string;
  request_date_ms: number;
  subscriber: {
    entitlements: Record<string, {
      expires_date: string | null;
      grace_period_expires_date: string | null;
      product_identifier: string;
      purchase_date: string;
    }>;
    first_seen: string;
    last_seen: string;
    management_url: string | null;
    non_subscriptions: Record<string, Array<{
      id: string;
      is_sandbox: boolean;
      purchase_date: string;
      store: string;
    }>>;
    original_app_user_id: string;
    subscriptions: Record<string, {
      auto_resume_date: string | null;
      billing_issues_detected_at: string | null;
      expires_date: string;
      is_sandbox: boolean;
      original_purchase_date: string;
      period_type: string;
      purchase_date: string;
      store: string;
      unsubscribe_detected_at: string | null;
    }>;
  };
}

function mapSubscriberToProperties(subscriber: RevenueCatSubscriberResponse["subscriber"]): Record<string, string> {
  const props: Record<string, string> = {};

  const entitlementNames = Object.keys(subscriber.entitlements);
  const hasActive = entitlementNames.some((name) => {
    const ent = subscriber.entitlements[name];
    return !ent.expires_date || new Date(ent.expires_date) > new Date();
  });

  props.rc_subscriber = hasActive ? "true" : "false";
  props.rc_status = hasActive ? "active" : "expired";

  if (entitlementNames.length > 0) {
    props.rc_entitlements = entitlementNames.join(",");
  }

  const products = entitlementNames
    .map((name) => subscriber.entitlements[name].product_identifier)
    .filter(Boolean);
  if (products.length > 0) {
    props.rc_product = products[0];
  }

  return props;
}

async function fetchRevenueCatSubscriber(
  apiKey: string,
  userId: string,
): Promise<RevenueCatSubscriberResponse | null> {
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as RevenueCatSubscriberResponse;
  } catch {
    return null;
  }
}

export const revenuecatSyncHandler: JobHandler = async (ctx, params) => {
  const projectId = params.project_id as string;
  const integrationId = params.integration_id as string;

  if (!projectId || !integrationId) {
    throw new Error("project_id and integration_id are required");
  }

  // Load integration config
  const [integration] = await ctx.db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.id, integrationId),
        eq(projectIntegrations.project_id, projectId),
        isNull(projectIntegrations.deleted_at),
        eq(projectIntegrations.enabled, true),
      ),
    )
    .limit(1);

  if (!integration) {
    throw new Error("RevenueCat integration not found or disabled");
  }

  const rcConfig = integration.config as unknown as RevenueCatConfig;

  // Get all app IDs in the project
  const appRows = await ctx.db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.project_id, projectId), isNull(apps.deleted_at)));
  const appIds = appRows.map((a) => a.id);

  if (appIds.length === 0) {
    return { synced: 0, total: 0, skipped: 0 };
  }

  // Get all non-anonymous users
  const users = await ctx.db
    .select({ id: appUsers.id, app_id: appUsers.app_id, user_id: appUsers.user_id })
    .from(appUsers)
    .where(
      and(
        inArray(appUsers.app_id, appIds),
        eq(appUsers.is_anonymous, false),
      ),
    );

  if (users.length === 0) {
    return { synced: 0, total: 0, skipped: 0 };
  }

  const total = users.length;
  let synced = 0;
  let skipped = 0;

  await ctx.updateProgress({ processed: 0, total, message: "Starting sync..." });

  for (let i = 0; i < users.length; i++) {
    if (ctx.isCancelled()) {
      ctx.log.info(`RevenueCat sync cancelled at ${i}/${total}`);
      return { synced, total, skipped, cancelled_at: i };
    }

    const user = users[i];
    try {
      const subscriberData = await fetchRevenueCatSubscriber(rcConfig.api_key, user.user_id);
      if (subscriberData) {
        const props = mapSubscriberToProperties(subscriberData.subscriber);
        if (Object.keys(props).length > 0) {
          await mergeUserProperties(ctx.db, user.app_id, user.user_id, props);
          synced++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
      // Rate limit: ~3 requests per second (180/min)
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      ctx.log.warn({ err, userId: user.user_id }, "RC sync failed for user");
      skipped++;
    }

    // Update progress every 10 users
    if ((i + 1) % 10 === 0 || i === users.length - 1) {
      await ctx.updateProgress({
        processed: i + 1,
        total,
        message: `Synced ${synced} users, ${skipped} skipped`,
      });
    }
  }

  ctx.log.info(`RevenueCat sync complete: ${synced}/${total} users updated`);
  return { synced, total, skipped };
};
