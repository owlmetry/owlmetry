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
  RC_ANONYMOUS_PREFIX,
  fetchRevenueCatProjectId,
  fetchRevenueCatCustomer,
  computeBillingPeriod,
} from "../utils/revenuecat.js";
import {
  fetchRevenueCatLookupMaps,
  syncRevenueCatUserProperties,
  resyncRevenueCatUsersInBackground,
  resolveRevenueCatProjectId,
} from "../utils/revenuecat-user-sync.js";

interface RevenueCatWebhookEvent {
  type: string;
  id: string;
  event_timestamp_ms: number;
  app_user_id?: string | null;
  // TRANSFER events have neither `original_app_user_id` nor `aliases` — RC
  // ships the affected user IDs in `transferred_from` / `transferred_to`
  // instead. Both fields are optional so the type covers TRANSFER alongside
  // the standard subscription event shape.
  original_app_user_id?: string;
  aliases?: string[];
  transferred_from?: string[];
  transferred_to?: string[];
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

// Event types that change a user's lifetime revenue — both subscription
// lifecycle (revenue comes from subs) and one-time paid IAPs (non-subs).
// Used to gate the background V2 resync that refreshes the typed
// `total_revenue_usd_cents` column after each event.
const REVENUE_AFFECTING_EVENT_TYPES = new Set([
  ...SUBSCRIPTION_EVENT_TYPES,
  "NON_RENEWING_PURCHASE",
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
    case "NON_RENEWING_PURCHASE":
      // One-time paid IAP (lifetime / consumable / non-consumable). The user
      // is a paying customer (rc_subscriber=true drives the "💰 Paid" badge)
      // but won't renew — they own it, no billing cycle to cancel.
      props.rc_subscriber = "true";
      props.rc_status = "active";
      props.rc_will_renew = "false";
      props.rc_period_type = "lifetime";
      props.rc_billing_period = "lifetime";
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

  // Period type and billing period only come from real subscription events
  // (NON_RENEWING_PURCHASE sets its own above). TEST / other unknown event
  // types shouldn't overwrite a user's prior state.
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

      // TRANSFER events ship neither `app_user_id` nor `original_app_user_id` —
      // affected user IDs are in `transferred_from` / `transferred_to`. The
      // payload itself carries no actionable subscription state, so we ack
      // immediately and re-sync each affected user against RC's V2 API in the
      // background. RC's `$RCAnonymousID:*` form doesn't map to Owlmetry
      // user_ids and is dropped from the candidate list.
      // https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields#transfer
      if (event.type === "TRANSFER") {
        const candidates = [
          ...(event.transferred_from ?? []),
          ...(event.transferred_to ?? []),
        ].filter(
          (id): id is string =>
            typeof id === "string" && id.length > 0 && !id.startsWith(RC_ANONYMOUS_PREFIX),
        );

        resyncRevenueCatUsersInBackground({
          db: app.db,
          log: request.log,
          projectId,
          config,
          userIds: candidates,
          context: "transfer",
          eventId: event.id,
        });

        return { received: true };
      }

      // Standard subscription events use `app_user_id`, falling back to
      // `original_app_user_id` if the SDK aliased the user (e.g. anon → real).
      let userId = event.app_user_id || event.original_app_user_id;
      if (!userId) {
        return reply.code(400).send({ error: "Invalid webhook payload: no user ID" });
      }

      // RC fires webhooks under whatever app_user_id was current at purchase
      // time — a purchase made while the SDK was still anonymous arrives as
      // `$RCAnonymousID:*`, which doesn't map to an Owlmetry user_id. Writing
      // under it would create a phantom app_users row that hoards the
      // subscription props (and revenue, via the resync below) instead of the
      // real user. RC's V2 customers endpoint resolves aliases — GET on the
      // anonymous id returns the canonical customer — so translate to the
      // canonical id and fall through to the unchanged downstream flow.
      // Non-anonymous events skip this entirely (zero added RC calls).
      if (userId.startsWith(RC_ANONYMOUS_PREFIX)) {
        const projectIdResult = await resolveRevenueCatProjectId(config.api_key);
        if (projectIdResult.status !== "found") {
          // 503 so RC retries — webhook-only props (e.g. cancellation state)
          // would otherwise be lost, and the handler is idempotent so retries
          // are safe.
          request.log.warn(
            {
              projectId,
              eventId: event.id,
              status: projectIdResult.status,
              statusCode: projectIdResult.status === "error" ? projectIdResult.statusCode : undefined,
            },
            "RC webhook: could not resolve RevenueCat project for anonymous ID (503 so RC retries)",
          );
          return reply.code(503).send({ error: "Could not resolve RevenueCat project" });
        }
        const customerResult = await fetchRevenueCatCustomer(
          config.api_key,
          projectIdResult.projectId,
          userId,
        );
        if (customerResult.status === "not_found") {
          request.log.info(
            { projectId, userId, eventId: event.id },
            "RC webhook: anonymous customer not found in RC (acked — nothing to attach to)",
          );
          return { received: true };
        }
        if (customerResult.status === "error") {
          request.log.warn(
            {
              projectId,
              userId,
              eventId: event.id,
              statusCode: customerResult.statusCode,
              message: customerResult.message,
            },
            "RC webhook: customer lookup failed for anonymous ID (503 so RC retries)",
          );
          return reply.code(503).send({ error: "RevenueCat API error" });
        }
        if (customerResult.customer.id.startsWith(RC_ANONYMOUS_PREFIX)) {
          // Customer was never aliased to a real user ID — skip rather than
          // create a phantom row.
          request.log.info(
            { projectId, userId, eventId: event.id },
            "RC webhook: anonymous customer has no canonical alias (skipped)",
          );
          return { received: true };
        }
        userId = customerResult.customer.id;
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

      // Subscription and one-time-purchase events change lifetime revenue
      // (`total_revenue_in_usd` per line item) — kick off a per-user resync
      // against RC's V2 API so the typed `total_revenue_usd_cents` column
      // stays fresh within seconds of the event. The resync pulls both
      // subs and non-subs, so a `NON_RENEWING_PURCHASE` event updates revenue
      // even though the webhook itself carries only `price` not lifetime totals.
      if (REVENUE_AFFECTING_EVENT_TYPES.has(event.type)) {
        resyncRevenueCatUsersInBackground({
          db: app.db,
          log: request.log,
          projectId,
          config,
          userIds: [userId],
          context: event.type === "NON_RENEWING_PURCHASE"
            ? "non_renewing_purchase_event"
            : "subscription_event",
          eventId: event.id,
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

      // RC anonymous IDs never map to an Owlmetry user_id. RC's V2 customer
      // endpoints resolve aliases, so a sync on `$RCAnonymousID:*` would
      // "succeed" and upsert the canonical customer's props + revenue under
      // a phantom app_users row (mergeUserProperties creates the row if
      // missing) — recreating exactly what the webhook's anonymous-id
      // translation exists to prevent. Reject before burning RC round-trips.
      if (userId.startsWith(RC_ANONYMOUS_PREFIX)) {
        return reply.code(400).send({
          error: "Cannot sync a RevenueCat anonymous ID — its data belongs to the canonical (aliased) user",
        });
      }

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

      const lookups = await fetchRevenueCatLookupMaps({
        apiKey: rcConfig.api_key,
        rcProjectId: projectIdResult.projectId,
        log: app.log,
      });

      const result = await syncRevenueCatUserProperties({
        db: app.db,
        log: app.log,
        projectId,
        rcProjectId: projectIdResult.projectId,
        config: rcConfig,
        userId,
        lookups,
      });

      if (result.status === "not_found") {
        return reply.code(404).send({ error: "Subscriber not found in RevenueCat" });
      }
      if (result.status === "error") {
        app.log.warn(
          { projectId, userId, statusCode: result.statusCode, message: result.message },
          "RevenueCat API error during single-user sync",
        );
        return reply.code(502).send({
          error: "RevenueCat API error",
          statusCode: result.statusCode,
          message: result.message,
        });
      }

      return { updated: 1, properties: result.properties };
    }
  );
}
