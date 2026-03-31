import type { FastifyInstance } from "fastify";
import { and, eq, sql, inArray, isNull } from "drizzle-orm";
import {
  events,
  apps,
  appUsers,
  appUserApps,
  funnelEvents,
  metricEvents,
} from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";
import type { IdentityClaimRequest, IdentityClaimResponse } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { resolveProjectIdFromApp } from "../utils/project.js";

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

      // Resolve project_id and all sibling app IDs in one query
      const project_id = await resolveProjectIdFromApp(app, app_id);
      if (!project_id) {
        return reply.code(400).send({ error: "App not found" });
      }

      const projectApps = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.project_id, project_id), isNull(apps.deleted_at)));
      const projectAppIds = projectApps.map((a) => a.id);

      // Execute all checks and updates in a single transaction
      const eventsReassignedCount = await app.db.transaction(async (tx) => {
        // Idempotency: check if the real user already has this anonymous_id in claimed_from
        const [realUserRow] = await tx
          .select()
          .from(appUsers)
          .where(
            and(
              eq(appUsers.project_id, project_id),
              eq(appUsers.user_id, user_id)
            )
          )
          .limit(1);

        if (realUserRow?.claimed_from?.includes(anonymous_id)) {
          return -1; // sentinel: already claimed
        }

        // Update events user_id from anonymous to real (across all project apps)
        const updatedEvents = await tx
          .update(events)
          .set({ user_id: user_id })
          .where(
            and(
              inArray(events.app_id, projectAppIds),
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
              inArray(funnelEvents.app_id, projectAppIds),
              eq(funnelEvents.user_id, anonymous_id)
            )
          );

        // Reassign metric_events user_id from anonymous to real
        await tx
          .update(metricEvents)
          .set({ user_id: user_id })
          .where(
            and(
              inArray(metricEvents.app_id, projectAppIds),
              eq(metricEvents.user_id, anonymous_id)
            )
          );

        // Merge app_users: fetch anonymous row (project-scoped)
        const [anonRow] = await tx
          .select()
          .from(appUsers)
          .where(
            and(
              eq(appUsers.project_id, project_id),
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
          // Merge properties: anonymous props as base, real user props win on conflict
          if (anonRow?.properties) {
            const anonProps = (anonRow.properties as Record<string, string>) ?? {};
            const realProps = (realUserRow.properties as Record<string, string>) ?? {};
            updates.properties = { ...anonProps, ...realProps };
          }
          await tx
            .update(appUsers)
            .set(updates)
            .where(eq(appUsers.id, realUserRow.id));

          // Merge junction entries from anonymous user to real user
          if (anonRow) {
            const anonJunctions = await tx
              .select()
              .from(appUserApps)
              .where(eq(appUserApps.app_user_id, anonRow.id));

            for (const j of anonJunctions) {
              await tx
                .insert(appUserApps)
                .values({
                  app_user_id: realUserRow.id,
                  app_id: j.app_id,
                  first_seen_at: j.first_seen_at,
                  last_seen_at: j.last_seen_at,
                })
                .onConflictDoUpdate({
                  target: [appUserApps.app_user_id, appUserApps.app_id],
                  set: {
                    first_seen_at: sql`LEAST(${appUserApps.first_seen_at}, EXCLUDED.first_seen_at)`,
                    last_seen_at: sql`GREATEST(${appUserApps.last_seen_at}, EXCLUDED.last_seen_at)`,
                  },
                });
            }

            // Delete the anonymous row (cascades junction entries)
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
