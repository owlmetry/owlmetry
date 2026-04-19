import type { FastifyInstance } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import { projectIntegrations, appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { mergeUserProperties } from "../utils/user-properties.js";
import {
  type RevenueCatConfig,
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

      await mergeUserProperties(app.db, projectId, userId, props);

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

      // Get all non-anonymous users in the project
      const users = await app.db
        .select({ id: appUsers.id, user_id: appUsers.user_id })
        .from(appUsers)
        .where(
          and(
            eq(appUsers.project_id, projectId),
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
        params: { project_id: projectId },
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

      const subscriberResult = await fetchRevenueCatSubscriber(rcConfig.api_key, userId);
      if (subscriberResult.status === "not_found") {
        return reply.code(404).send({ error: "Subscriber not found in RevenueCat" });
      }
      if (subscriberResult.status === "error") {
        app.log.warn(
          { projectId, userId, statusCode: subscriberResult.statusCode, message: subscriberResult.message },
          "RevenueCat API error during single-user sync",
        );
        return reply.code(502).send({
          error: "RevenueCat API error",
          statusCode: subscriberResult.statusCode,
          message: subscriberResult.message,
        });
      }

      const props = mapSubscriberToProperties(subscriberResult.data.subscriber);
      await mergeUserProperties(app.db, projectId, userId, props);

      return { updated: 1, properties: props };
    }
  );
}
