import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  events,
  appUsers,
  funnelEvents,
} from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";
import type { IdentityClaimRequest, IdentityClaimResponse } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";

export async function identityRoutes(app: FastifyInstance) {
  app.post<{ Body: IdentityClaimRequest }>(
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

      // Execute all checks and updates in a single transaction
      const eventsReassignedCount = await app.db.transaction(async (tx) => {
        // Idempotency: check if the real user already has this anonymous_id in claimed_from
        const [realUserRow] = await tx
          .select()
          .from(appUsers)
          .where(
            and(
              eq(appUsers.app_id, app_id),
              eq(appUsers.user_id, user_id)
            )
          )
          .limit(1);

        if (realUserRow?.claimed_from?.includes(anonymous_id)) {
          return -1; // sentinel: already claimed
        }

        // Update events user_id from anonymous to real
        const updatedEvents = await tx
          .update(events)
          .set({ user_id: user_id })
          .where(
            and(
              eq(events.app_id, app_id),
              eq(events.user_id, anonymous_id)
            )
          )
          .returning({ id: events.id });

        if (updatedEvents.length === 0) {
          return 0;
        }

        // Reassign funnel_events user_id from anonymous to real
        await tx
          .update(funnelEvents)
          .set({ user_id: user_id })
          .where(
            and(
              eq(funnelEvents.app_id, app_id),
              eq(funnelEvents.user_id, anonymous_id)
            )
          );

        // Merge app_users: fetch anonymous row
        const [anonRow] = await tx
          .select()
          .from(appUsers)
          .where(
            and(
              eq(appUsers.app_id, app_id),
              eq(appUsers.user_id, anonymous_id)
            )
          )
          .limit(1);

        if (realUserRow) {
          // Real user exists — merge: append anonymous_id to claimed_from, take earliest first_seen_at
          const newClaimedFrom = [...(realUserRow.claimed_from ?? []), anonymous_id];
          const updates: Record<string, unknown> = {
            claimed_from: newClaimedFrom,
          };
          if (anonRow && anonRow.first_seen_at < realUserRow.first_seen_at) {
            updates.first_seen_at = anonRow.first_seen_at;
          }
          await tx
            .update(appUsers)
            .set(updates)
            .where(eq(appUsers.id, realUserRow.id));

          // Delete the anonymous row if it exists
          if (anonRow) {
            await tx
              .delete(appUsers)
              .where(eq(appUsers.id, anonRow.id));
          }
        } else if (anonRow) {
          // No real user row — update anonymous row in-place
          await tx
            .update(appUsers)
            .set({
              user_id: user_id,
              is_anonymous: false,
              claimed_from: [anonymous_id],
            })
            .where(eq(appUsers.id, anonRow.id));
        }
        // If neither exists, the claim still succeeds (events were reassigned)

        return updatedEvents.length;
      });

      if (eventsReassignedCount === -1) {
        return {
          claimed: true,
          events_reassigned_count: 0,
        } satisfies IdentityClaimResponse;
      }

      if (eventsReassignedCount === 0) {
        return reply
          .code(404)
          .send({ error: "No events found for this anonymous_id" });
      }

      return {
        claimed: true,
        events_reassigned_count: eventsReassignedCount,
      } satisfies IdentityClaimResponse;
    }
  );
}
