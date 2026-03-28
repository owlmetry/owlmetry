import type { FastifyInstance } from "fastify";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { projectIntegrations, apps, appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { mergeUserProperties } from "../utils/user-properties.js";
import {
  type RevenueCatConfig,
  type RevenueCatSubscriberResponse,
  mapSubscriberToProperties,
  fetchRevenueCatSubscriber,
} from "../utils/revenuecat.js";

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
  price?: number | null;
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

async function findActiveRevenueCatIntegration(db: Db, projectId: string) {
  const [integration] = await db
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
  return integration ?? null;
}

async function getProjectAppIds(db: Db, projectId: string): Promise<string[]> {
  const rows = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.project_id, projectId), isNull(apps.deleted_at)));
  return rows.map((a) => a.id);
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

/** Apply properties to a user across all apps in a project. */
async function applyPropsToProjectUser(
  db: Db,
  appIds: string[],
  userId: string,
  props: Record<string, string>,
): Promise<number> {
  let updated = 0;
  await Promise.all(appIds.map(async (appId) => {
    await mergeUserProperties(db, appId, userId, props);
    updated++;
  }));
  return updated;
}

// --- Routes ---

export async function revenuecatRoutes(app: FastifyInstance) {
  // Webhook receiver — no standard auth, uses webhook_secret from integration config
  app.post<{ Params: { projectId: string }; Body: RevenueCatWebhookPayload }>(
    "/webhooks/revenuecat/:projectId",
    async (request, reply) => {
      const { projectId } = request.params;

      const integration = await findActiveRevenueCatIntegration(app.db, projectId);
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

      const appIds = await getProjectAppIds(app.db, projectId);
      await applyPropsToProjectUser(app.db, appIds, userId, props);

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

      const integration = await findActiveRevenueCatIntegration(app.db, projectId);
      if (!integration) {
        return reply.code(404).send({ error: "RevenueCat integration not found or disabled" });
      }

      const rcConfig = integration.config as unknown as RevenueCatConfig;
      const appIds = await getProjectAppIds(app.db, projectId);

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

      const totalUsers = users.length;

      const triggeredBy =
        request.auth.type === "user"
          ? `manual:user:${request.auth.user_id}`
          : `manual:api_key:${request.auth.key_id}`;

      const run = await app.jobRunner.trigger("revenuecat_sync", {
        triggeredBy,
        teamId: project.team_id,
        projectId,
        params: { project_id: projectId, integration_id: integration.id },
      });

      return { syncing: true, total: totalUsers, job_run_id: run.id };
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

      const integration = await findActiveRevenueCatIntegration(app.db, projectId);
      if (!integration) {
        return reply.code(404).send({ error: "RevenueCat integration not found or disabled" });
      }

      const rcConfig = integration.config as unknown as RevenueCatConfig;

      const subscriberData = await fetchRevenueCatSubscriber(rcConfig.api_key, userId);
      if (!subscriberData) {
        return reply.code(404).send({ error: "Subscriber not found in RevenueCat" });
      }

      const props = mapSubscriberToProperties(subscriberData.subscriber);
      const appIds = await getProjectAppIds(app.db, projectId);
      const updated = await applyPropsToProjectUser(app.db, appIds, userId, props);

      return { updated, properties: props };
    }
  );
}
