import type { FastifyInstance } from "fastify";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { projectIntegrations, apps, appUsers } from "@owlmetry/db";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";

interface RevenueCatConfig {
  api_key: string;
  webhook_secret: string;
}

// --- RevenueCat Webhook types (exact format from RC docs) ---

interface RevenueCatWebhookEvent {
  type: string;
  id: string;
  event_timestamp_ms: number;
  app_user_id?: string | null;
  original_app_user_id: string;
  aliases: string[];
  product_id?: string;
  entitlement_id?: string | null;
  entitlement_ids?: string[] | null;
  period_type?: string | null;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  store?: string;
  environment?: "SANDBOX" | "PRODUCTION";
  is_trial_conversion?: boolean;
  cancel_reason?: string | null;
  expiration_reason?: string | null;
  new_product_id?: string | null;
  currency?: string | null;
  price?: number | null; // USD equivalent
  price_in_purchased_currency?: number | null;
  country_code?: string;
  subscriber_attributes: Record<string, { value: string; updated_at_ms: number }>;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
}

interface RevenueCatWebhookPayload {
  api_version: string;
  event: RevenueCatWebhookEvent;
}

// --- RevenueCat Subscriber API types (GET /v1/subscribers/:id) ---

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

function mapWebhookEventToProperties(event: RevenueCatWebhookEvent): Record<string, string> {
  const props: Record<string, string> = {};

  switch (event.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "UNCANCELLATION":
      props.rc_subscriber = "true";
      props.rc_status = "active";
      break;
    case "CANCELLATION":
      props.rc_subscriber = "false";
      props.rc_status = "cancelled";
      break;
    case "BILLING_ISSUE":
      props.rc_status = "billing_issue";
      break;
    case "EXPIRATION":
      props.rc_subscriber = "false";
      props.rc_status = "expired";
      break;
  }

  if (event.product_id) {
    props.rc_product = event.product_id;
  }
  if (event.price_in_purchased_currency !== undefined && event.currency) {
    props.rc_last_purchase = `${event.price_in_purchased_currency} ${event.currency}`;
  }
  if (event.entitlement_ids && event.entitlement_ids.length > 0) {
    props.rc_entitlements = event.entitlement_ids.join(",");
  }

  return props;
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

async function mergeUserProperties(
  db: any,
  appId: string,
  userId: string,
  newProps: Record<string, string>,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(appUsers)
    .where(and(eq(appUsers.app_id, appId), eq(appUsers.user_id, userId)))
    .limit(1);

  const merged = { ...((existing?.properties as Record<string, string>) ?? {}), ...newProps };

  if (existing) {
    await db
      .update(appUsers)
      .set({ properties: merged })
      .where(eq(appUsers.id, existing.id));
  } else {
    await db
      .insert(appUsers)
      .values({
        app_id: appId,
        user_id: userId,
        is_anonymous: userId.startsWith(ANONYMOUS_ID_PREFIX),
        properties: merged,
      });
  }
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

/** Webhook + sync routes for RevenueCat integration. */
export async function revenuecatRoutes(app: FastifyInstance) {
  // Webhook receiver — no standard auth, uses webhook_secret from integration config
  app.post<{ Params: { projectId: string }; Body: RevenueCatWebhookPayload }>(
    "/webhooks/revenuecat/:projectId",
    async (request, reply) => {
      const { projectId } = request.params;

      // Look up the integration config
      const [integration] = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, projectId),
            eq(projectIntegrations.provider, "revenuecat"),
            isNull(projectIntegrations.deleted_at),
            eq(projectIntegrations.enabled, true),
          )
        )
        .limit(1);

      if (!integration) {
        return reply.code(404).send({ error: "RevenueCat integration not found or disabled" });
      }

      const config = integration.config as unknown as RevenueCatConfig;

      // Validate webhook secret (skip if not configured)
      if (config.webhook_secret) {
        const authHeader = request.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${config.webhook_secret}`) {
          return reply.code(401).send({ error: "Invalid webhook secret" });
        }
      }

      const { event } = request.body;
      if (!event) {
        return reply.code(400).send({ error: "Invalid webhook payload: missing event" });
      }

      // Resolve user ID: app_user_id may be null (e.g. TRANSFER), fall back to original_app_user_id
      const userId = event.app_user_id || event.original_app_user_id;
      if (!userId) {
        return reply.code(400).send({ error: "Invalid webhook payload: no user ID" });
      }

      const props = mapWebhookEventToProperties(event);
      if (Object.keys(props).length === 0) {
        return { received: true };
      }

      // Update user properties across all apps in the project
      const appIds = (await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.project_id, projectId), isNull(apps.deleted_at)))
      ).map((a) => a.id);

      // Update user properties across matching apps
      for (const appId of appIds) {
        await mergeUserProperties(app.db, appId, userId, props).catch((err) => {
          request.log.warn({ err, appId, userId }, "Failed to update user properties from webhook");
        });
      }

      return { received: true };
    }
  );

  // Bulk sync — fetches subscriber data from RevenueCat for all users
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/integrations/revenuecat/sync",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const [integration] = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, projectId),
            eq(projectIntegrations.provider, "revenuecat"),
            isNull(projectIntegrations.deleted_at),
            eq(projectIntegrations.enabled, true),
          )
        )
        .limit(1);

      if (!integration) {
        return reply.code(404).send({ error: "RevenueCat integration not found or disabled" });
      }

      const rcConfig = integration.config as unknown as RevenueCatConfig;

      // Get all app IDs for this project
      const projectApps = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.project_id, projectId), isNull(apps.deleted_at)));

      const appIds = projectApps.map((a) => a.id);

      if (appIds.length === 0) {
        return reply.code(400).send({ error: "No apps in this project" });
      }

      // Get all non-anonymous users across project apps
      const users = await app.db
        .select({ id: appUsers.id, app_id: appUsers.app_id, user_id: appUsers.user_id })
        .from(appUsers)
        .where(
          and(
            inArray(appUsers.app_id, appIds),
            eq(appUsers.is_anonymous, false),
          )
        );

      if (users.length === 0) {
        return { synced: 0, total: 0 };
      }

      // Run sync in background — return immediately
      const totalUsers = users.length;

      // Fire-and-forget background sync
      (async () => {
        let synced = 0;
        for (const user of users) {
          try {
            const subscriberData = await fetchRevenueCatSubscriber(rcConfig.api_key, user.user_id);
            if (subscriberData) {
              const props = mapSubscriberToProperties(subscriberData.subscriber);
              if (Object.keys(props).length > 0) {
                const existing = await app.db
                  .select()
                  .from(appUsers)
                  .where(eq(appUsers.id, user.id))
                  .limit(1);
                const merged = { ...((existing[0]?.properties as Record<string, string>) ?? {}), ...props };
                await app.db
                  .update(appUsers)
                  .set({ properties: merged })
                  .where(eq(appUsers.id, user.id));
                synced++;
              }
            }
            // Rate limit: ~3 requests per second (180/min)
            await new Promise((r) => setTimeout(r, 350));
          } catch (err) {
            app.log.warn({ err, userId: user.user_id }, "RC sync failed for user");
          }
        }
        app.log.info(`RevenueCat sync complete: ${synced}/${totalUsers} users updated`);
      })().catch((err) => {
        app.log.error({ err }, "RevenueCat bulk sync failed");
      });

      return { syncing: true, total: totalUsers };
    }
  );

  // Single-user sync
  app.post<{ Params: { projectId: string; userId: string } }>(
    "/projects/:projectId/integrations/revenuecat/sync/:userId",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId, userId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const [integration] = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, projectId),
            eq(projectIntegrations.provider, "revenuecat"),
            isNull(projectIntegrations.deleted_at),
            eq(projectIntegrations.enabled, true),
          )
        )
        .limit(1);

      if (!integration) {
        return reply.code(404).send({ error: "RevenueCat integration not found or disabled" });
      }

      const rcConfig = integration.config as unknown as RevenueCatConfig;

      const subscriberData = await fetchRevenueCatSubscriber(rcConfig.api_key, userId);
      if (!subscriberData) {
        return reply.code(404).send({ error: "Subscriber not found in RevenueCat" });
      }

      const props = mapSubscriberToProperties(subscriberData.subscriber);

      // Get all app IDs for this project
      const appIds = (await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.project_id, projectId), isNull(apps.deleted_at)))
      ).map((a) => a.id);

      let updated = 0;
      for (const appId of appIds) {
        const [user] = await app.db
          .select()
          .from(appUsers)
          .where(and(eq(appUsers.app_id, appId), eq(appUsers.user_id, userId)))
          .limit(1);

        if (user) {
          const merged = { ...((user.properties as Record<string, string>) ?? {}), ...props };
          await app.db
            .update(appUsers)
            .set({ properties: merged })
            .where(eq(appUsers.id, user.id));
          updated++;
        }
      }

      return { updated, properties: props };
    }
  );
}
