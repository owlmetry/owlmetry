import type { FastifyInstance } from "fastify";
import { and, eq, sql, inArray, isNull } from "drizzle-orm";
import {
  events,
  apps,
  appUsers,
  funnelEvents,
  metricEvents,
  questionnaireResponses,
  issues,
  issueOccurrences,
  feedback,
  eventAttachments,
} from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";
import type { IdentityClaimRequest, IdentityClaimResponse } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { resolveProjectIdFromApp } from "../utils/project.js";
import { mergeAnonAppUserRowIntoReal } from "../utils/claimed-identity.js";

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

      // Execute all checks and updates in a single transaction.
      //
      // Contract change vs. earlier behaviour: this endpoint now ALWAYS
      // registers the anon→real mapping in app_users.claimed_from, even
      // when zero events match the anonymous_id at the moment the claim
      // arrives. The previous "return 404 if no events" path silently
      // dropped the claim and let any late-arriving anon events orphan
      // onto a separate app_users row that resolveClaimedUserIds could
      // never find a mapping for. The Signature Creator orphan-user bug
      // (CLAUDE.md "Identity") was exactly that race — the SDK's setUser
      // beat its own ingest flush and the server returned 404 instead of
      // remembering the mapping.
      const eventsReassignedCount = await app.db.transaction(async (tx) => {
        // Idempotency: if the real user already has this anonymous_id in
        // claimed_from, the merge is done — short-circuit.
        const [existingRealUserRow] = await tx
          .select()
          .from(appUsers)
          .where(
            and(
              eq(appUsers.project_id, project_id),
              eq(appUsers.user_id, user_id)
            )
          )
          .limit(1);

        if (existingRealUserRow?.claimed_from?.includes(anonymous_id)) {
          return -1; // sentinel: already claimed
        }

        // Reassign events user_id from anonymous to real (across all project apps).
        // Zero rows is a valid outcome — the events may not have arrived yet
        // (SDK race). resolveClaimedUserIds at /v1/ingest will rewrite them
        // when they do, because the merge below registers claimed_from.
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

        // Rewrite anonymous user_id on tables that carry the SDK end-user id but
        // are not partitioned and have no UNIQUE constraint involving user_id.
        // Without these, opening the real user's profile post-claim would miss
        // their pre-claim error occurrences, feedback, and attachments.
        // issue_occurrences has no project_id column — scope via its issue's
        // project_id. issues.unique_user_count is self-healed by the hourly
        // issue_scan job so it isn't recomputed here.
        await tx
          .update(issueOccurrences)
          .set({ user_id: user_id })
          .where(
            and(
              eq(issueOccurrences.user_id, anonymous_id),
              sql`EXISTS (
                SELECT 1 FROM ${issues}
                WHERE ${issues.id} = ${issueOccurrences.issue_id}
                  AND ${issues.project_id} = ${project_id}
              )`,
            ),
          );

        await tx
          .update(feedback)
          .set({ user_id: user_id })
          .where(
            and(
              eq(feedback.project_id, project_id),
              eq(feedback.user_id, anonymous_id),
              isNull(feedback.deleted_at),
            ),
          );

        await tx
          .update(eventAttachments)
          .set({ user_id: user_id })
          .where(
            and(
              eq(eventAttachments.project_id, project_id),
              eq(eventAttachments.user_id, anonymous_id),
              isNull(eventAttachments.deleted_at),
            ),
          );

        // Migrate questionnaire_responses.user_id from anonymous → real.
        // The partial unique index `(project_id, slug, user_id) WHERE
        // deleted_at IS NULL AND user_id IS NOT NULL` enforces one row per
        // (project, slug, user); a direct UPDATE could violate it if the
        // real id already has a row for the same questionnaire. We resolve
        // by precedence:
        //   1. Only update the anon row when no real-user row exists for
        //      the same (project, slug). The NOT EXISTS guard side-steps
        //      the index conflict and preserves the (presumably submitted)
        //      real row's history.
        //   2. Any anon rows left after that — i.e., those that conflicted
        //      with a sibling-device real row — get soft-deleted. A
        //      half-completed anon draft is acceptable to lose; submitted
        //      real responses win.
        await tx
          .update(questionnaireResponses)
          .set({ user_id: user_id })
          .where(
            and(
              eq(questionnaireResponses.project_id, project_id),
              eq(questionnaireResponses.user_id, anonymous_id),
              isNull(questionnaireResponses.deleted_at),
              sql`NOT EXISTS (
                SELECT 1 FROM ${questionnaireResponses} r2
                WHERE r2.project_id = ${project_id}
                  AND r2.slug = ${questionnaireResponses.slug}
                  AND r2.user_id = ${user_id}
                  AND r2.deleted_at IS NULL
              )`,
            ),
          );
        await tx
          .update(questionnaireResponses)
          .set({ deleted_at: new Date() })
          .where(
            and(
              eq(questionnaireResponses.project_id, project_id),
              eq(questionnaireResponses.user_id, anonymous_id),
              isNull(questionnaireResponses.deleted_at),
            ),
          );

        // Re-fetch realUserRow + anonRow inside the transaction. Under
        // READ COMMITTED a concurrent /v1/ingest (with its now-awaited
        // upsertAppUsers) can commit and become visible between the
        // idempotency SELECT above and here, and we need the freshest view
        // before deciding which merge branch to take.
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
          // Real user exists — merge: append anonymous_id to claimed_from,
          // fold the anon row in via the shared merge primitive.
          const newClaimedFrom = [...(realUserRow.claimed_from ?? []), anonymous_id];
          if (anonRow) {
            await mergeAnonAppUserRowIntoReal(tx, anonRow, realUserRow, {
              claimed_from: newClaimedFrom,
            });
          } else {
            await tx
              .update(appUsers)
              .set({ claimed_from: newClaimedFrom })
              .where(eq(appUsers.id, realUserRow.id));
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
        } else {
          // Neither row exists — register the mapping anyway. Late events
          // arriving via /v1/ingest will be rewritten through claimed_from
          // by resolveClaimedUserIds. The ON CONFLICT branch handles the
          // case where a parallel ingest's upsertAppUsers materialises the
          // real-user row between our SELECT above and this INSERT.
          await tx
            .insert(appUsers)
            .values({
              project_id,
              user_id,
              is_anonymous: false,
              claimed_from: [anonymous_id],
            })
            .onConflictDoUpdate({
              target: [appUsers.project_id, appUsers.user_id],
              set: {
                claimed_from: sql`
                  CASE
                    WHEN ${appUsers.claimed_from} IS NULL
                      THEN ${JSON.stringify([anonymous_id])}::jsonb
                    WHEN NOT EXISTS (
                      SELECT 1 FROM jsonb_array_elements_text(${appUsers.claimed_from}) elt
                      WHERE elt = ${anonymous_id}
                    )
                      THEN ${appUsers.claimed_from} || ${JSON.stringify([anonymous_id])}::jsonb
                    ELSE ${appUsers.claimed_from}
                  END
                `,
              },
            });
        }

        return updatedEvents.length;
      });

      if (eventsReassignedCount === -1) {
        return {
          claimed: true,
          events_reassigned_count: 0,
        } satisfies IdentityClaimResponse;
      }

      return {
        claimed: true,
        events_reassigned_count: eventsReassignedCount,
      } satisfies IdentityClaimResponse;
    }
  );
}
