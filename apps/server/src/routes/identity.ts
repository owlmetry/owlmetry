import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  events,
  eventIdentityClaims,
  funnelDefinitions,
  funnelProgress,
} from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";
import type { ClaimRequest, ClaimResponse } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";

export async function identityRoutes(app: FastifyInstance) {
  app.post<{ Body: ClaimRequest }>(
    "/identity/claim",
    { preHandler: [requirePermission("events:write")] },
    async (request, reply) => {
      const auth = request.auth;
      const { anonymous_id, user_id } = request.body;

      // Validate request
      if (!anonymous_id || typeof anonymous_id !== "string") {
        return reply.code(400).send({ error: "anonymous_id is required" });
      }
      if (!user_id || typeof user_id !== "string") {
        return reply.code(400).send({ error: "user_id is required" });
      }

      if (!anonymous_id.startsWith(ANONYMOUS_ID_PREFIX)) {
        return reply
          .code(400)
          .send({
            error: `anonymous_id must start with "${ANONYMOUS_ID_PREFIX}"`,
          });
      }

      if (user_id.startsWith(ANONYMOUS_ID_PREFIX)) {
        return reply
          .code(400)
          .send({ error: "user_id must not start with anonymous prefix" });
      }

      const app_id = auth.type === "api_key" ? auth.app_id : null;
      if (!app_id) {
        return reply
          .code(400)
          .send({ error: "Client key must be scoped to an app" });
      }

      // Check idempotency before starting transaction
      const [existingClaim] = await app.db
        .select()
        .from(eventIdentityClaims)
        .where(
          and(
            eq(eventIdentityClaims.app_id, app_id),
            eq(eventIdentityClaims.anonymous_id, anonymous_id)
          )
        )
        .limit(1);

      if (existingClaim) {
        return {
          claimed: true,
          events_updated: existingClaim.events_updated,
        } satisfies ClaimResponse;
      }

      // Verify events exist before doing the update
      const [eventCheck] = await app.db
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.app_id, app_id),
            eq(events.user_identifier, anonymous_id)
          )
        );

      if (!eventCheck || eventCheck.count === 0) {
        return reply
          .code(404)
          .send({ error: "No events found for this anonymous_id" });
      }

      const eventsUpdated = eventCheck.count;

      // Execute updates + claim insert in a transaction
      await app.db.transaction(async (tx) => {
        // Update events and funnel progress in parallel
        const updateEventsPromise = tx
          .update(events)
          .set({ user_identifier: user_id })
          .where(
            and(
              eq(events.app_id, app_id),
              eq(events.user_identifier, anonymous_id)
            )
          );

        // Scope funnel progress update to funnels belonging to this app
        const appFunnelIds = await tx
          .select({ id: funnelDefinitions.id })
          .from(funnelDefinitions)
          .where(eq(funnelDefinitions.app_id, app_id));

        const funnelIds = appFunnelIds.map((f) => f.id);

        const updateFunnelsPromise =
          funnelIds.length > 0
            ? tx
                .update(funnelProgress)
                .set({ user_identifier: user_id })
                .where(
                  and(
                    eq(funnelProgress.user_identifier, anonymous_id),
                    inArray(funnelProgress.funnel_id, funnelIds)
                  )
                )
            : Promise.resolve();

        await Promise.all([updateEventsPromise, updateFunnelsPromise]);

        // Insert claim record with ON CONFLICT for concurrent request safety
        await tx
          .insert(eventIdentityClaims)
          .values({
            app_id,
            anonymous_id,
            user_id,
            events_updated: eventsUpdated,
          })
          .onConflictDoNothing({
            target: [
              eventIdentityClaims.app_id,
              eventIdentityClaims.anonymous_id,
            ],
          });
      });

      return {
        claimed: true,
        events_updated: eventsUpdated,
      } satisfies ClaimResponse;
    }
  );
}
