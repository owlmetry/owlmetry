import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { mergeUserProperties, selectUnsetProps } from "../utils/user-properties.js";
import { findActiveIntegration, formatManualTriggeredBy } from "../utils/integrations.js";
import {
  mapRevenueCatAttributesToAttributionProperties,
  normalizeWebhookSubscriberAttributes,
} from "../utils/attribution/revenuecat.js";
import {
  type RevenueCatConfig,
  mapSubscriberToProperties,
  fetchRevenueCatSubscriber,
  fetchRevenueCatSubscriptions,
  fetchRevenueCatCustomerAttributes,
  fetchRevenueCatProjectId,
  computeBillingPeriod,
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

function findActiveRevenueCatIntegration(db: Db, projectId: string) {
  return findActiveIntegration(db, projectId, "revenuecat");
}


const SUBSCRIPTION_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "CANCELLATION",
  "BILLING_ISSUE",
  "EXPIRATION",
]);

function mapWebhookEventToProperties(event: RevenueCatWebhookEvent): Record<string, string> {
  const props: Record<string, string> = {};
  const isSubscriptionEvent = SUBSCRIPTION_EVENT_TYPES.has(event.type);

  switch (event.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "UNCANCELLATION":
      props.rc_subscriber = "true";
      props.rc_status = "active";
      props.rc_will_renew = "true";
      break;
    case "CANCELLATION":
      // User cancelled but may still be entitled until period end. `rc_subscriber`
      // gates the "💰 Paid" badge; we flip it off so cancelled trials don't render
      // as paid. `rc_will_renew` lets the UI distinguish cancelled-trial (red)
      // from active-trial (sky).
      props.rc_subscriber = "false";
      props.rc_status = "cancelled";
      props.rc_will_renew = "false";
      break;
    case "BILLING_ISSUE":
      props.rc_status = "billing_issue";
      break;
    case "EXPIRATION":
      props.rc_subscriber = "false";
      props.rc_status = "expired";
      props.rc_will_renew = "false";
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

  // Period type and billing period only come from real subscription events.
  // TEST / other unknown event types shouldn't overwrite a user's prior state.
  if (isSubscriptionEvent) {
    if (event.period_type) {
      const periodType = event.period_type.toLowerCase();
      if (["trial", "intro", "normal", "promotional"].includes(periodType)) {
        props.rc_period_type = periodType;
      }
    }
    if (event.purchased_at_ms !== undefined) {
      const billingPeriod = computeBillingPeriod(
        event.purchased_at_ms,
        event.expiration_at_ms ?? null,
      );
      if (billingPeriod) props.rc_billing_period = billingPeriod;
    }
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

      const subscriberProps = mapWebhookEventToProperties(event);

      // Attribution backfill via subscriber_attributes. RC pipes
      // `$mediaSource` / `$campaign` / `$adGroup` / `$keyword` through every
      // webhook, which lets us fill attribution for active subscribers
      // without waiting on the next scheduled sync. Per-field merge — never
      // overwrite data we already have (Apple live / prior sync wins).
      let attributionProps: Record<string, string> = {};
      if (event.subscriber_attributes && Object.keys(event.subscriber_attributes).length > 0) {
        const mapped = mapRevenueCatAttributesToAttributionProperties(
          normalizeWebhookSubscriberAttributes(event.subscriber_attributes),
        );
        if (Object.keys(mapped).length > 0) {
          const [userRow] = await app.db
            .select({ properties: appUsers.properties })
            .from(appUsers)
            .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, userId)))
            .limit(1);
          const currentProps = (userRow?.properties ?? {}) as Record<string, unknown>;
          attributionProps = selectUnsetProps(mapped, currentProps);
        }
      }

      const combinedProps = { ...subscriberProps, ...attributionProps };
      if (Object.keys(combinedProps).length === 0) {
        return { received: true };
      }

      await mergeUserProperties(app.db, projectId, userId, combinedProps);

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

      const run = await app.jobRunner.trigger("revenuecat_sync", {
        triggeredBy: formatManualTriggeredBy(request.auth),
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

      const projectIdResult = await fetchRevenueCatProjectId(rcConfig.api_key);
      if (projectIdResult.status !== "found") {
        app.log.warn(
          { projectId, statusCode: projectIdResult.status === "error" ? projectIdResult.statusCode : undefined, message: projectIdResult.status === "error" ? projectIdResult.message : undefined },
          "RevenueCat API error while resolving project",
        );
        return reply.code(502).send({
          error: "RevenueCat API error",
          message: projectIdResult.status === "no_projects"
            ? "API key has no accessible projects"
            : projectIdResult.message,
          statusCode: projectIdResult.status === "error" ? projectIdResult.statusCode : undefined,
        });
      }

      const subscriberResult = await fetchRevenueCatSubscriber(rcConfig.api_key, projectIdResult.projectId, userId);
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

      // Fetch subscriptions and attributes concurrently — independent of the
      // entitlements call we already awaited. Fail-soft on both.
      const [subsResult, attrsResult] = await Promise.all([
        fetchRevenueCatSubscriptions(rcConfig.api_key, projectIdResult.projectId, userId),
        fetchRevenueCatCustomerAttributes(rcConfig.api_key, projectIdResult.projectId, userId),
      ]);
      const subsData = subsResult.status === "found" ? subsResult.data : undefined;
      if (subsResult.status === "error") {
        app.log.warn(
          { projectId, userId, statusCode: subsResult.statusCode, message: subsResult.message },
          "RC subscriptions fetch failed (continuing with entitlements-only props)",
        );
      }

      let attributionProps: Record<string, string> = {};
      if (attrsResult.status === "found") {
        const mapped = mapRevenueCatAttributesToAttributionProperties(attrsResult.attributes);
        if (Object.keys(mapped).length > 0) {
          const [userRow] = await app.db
            .select({ properties: appUsers.properties })
            .from(appUsers)
            .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, userId)))
            .limit(1);
          const currentProps = (userRow?.properties ?? {}) as Record<string, unknown>;
          attributionProps = selectUnsetProps(mapped, currentProps);
        }
      } else if (attrsResult.status === "error") {
        app.log.warn(
          { projectId, userId, statusCode: attrsResult.statusCode, message: attrsResult.message },
          "RC attributes fetch failed (continuing without attribution backfill)",
        );
      }

      const subscriberProps = mapSubscriberToProperties(subscriberResult.data, subsData);
      const props = { ...subscriberProps, ...attributionProps };
      await mergeUserProperties(app.db, projectId, userId, props);

      return { updated: 1, properties: props };
    }
  );
}
