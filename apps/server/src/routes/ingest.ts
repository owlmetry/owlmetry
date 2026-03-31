import type { FastifyInstance } from "fastify";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { apps, events } from "@owlmetry/db";
import {
  MAX_BATCH_SIZE,
  ALLOWED_ENVIRONMENTS_FOR_PLATFORM,
} from "@owlmetry/shared";
import type { IngestRequest, IngestEventPayload } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import {
  validateEventPayload,
  buildEventRow,
  dualWriteSpecializedEvents,
  upsertAppUsers,
} from "../utils/event-processing.js";

export async function ingestRoutes(app: FastifyInstance) {
  app.post<{ Body: IngestRequest }>(
    "/ingest",
    { preHandler: [requirePermission("events:write"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      const { bundle_id, events: payloads } = request.body;

      if (!Array.isArray(payloads) || payloads.length === 0) {
        return reply.code(400).send({ error: "events array is required" });
      }

      if (payloads.length > MAX_BATCH_SIZE) {
        return reply
          .code(400)
          .send({ error: `Maximum batch size is ${MAX_BATCH_SIZE}` });
      }

      const app_id =
        auth.type === "api_key" ? auth.app_id : null;

      if (!app_id) {
        return reply
          .code(400)
          .send({ error: "API key must be scoped to an app" });
      }

      const [appRow] = await app.db
        .select({ bundle_id: apps.bundle_id, platform: apps.platform, project_id: apps.project_id })
        .from(apps)
        .where(and(eq(apps.id, app_id), isNull(apps.deleted_at)))
        .limit(1);

      if (!appRow) {
        return reply
          .code(400)
          .send({ error: "App associated with this API key no longer exists" });
      }

      if (appRow.bundle_id) {
        if (!bundle_id || typeof bundle_id !== "string") {
          return reply
            .code(400)
            .send({ error: "bundle_id is required" });
        }
        if (bundle_id !== appRow.bundle_id) {
          return reply
            .code(403)
            .send({
              error: "bundle_id does not match the app associated with this API key",
            });
        }
      }

      const errors: Array<{ index: number; message: string }> = [];
      const validated: Array<{ index: number; event: IngestEventPayload }> = [];
      const allowedEnvironments = ALLOWED_ENVIRONMENTS_FOR_PLATFORM[
        appRow.platform as keyof typeof ALLOWED_ENVIRONMENTS_FOR_PLATFORM
      ];

      for (let i = 0; i < payloads.length; i++) {
        const e = payloads[i];
        const err = validateEventPayload(e, i, { maxAgeDays: 30 });
        if (err) {
          errors.push({ index: i, message: err });
          continue;
        }
        if (e.environment && !allowedEnvironments.includes(e.environment as any)) {
          errors.push({
            index: i,
            message: `events[${i}]: environment "${e.environment}" is not allowed for ${appRow.platform} apps (allowed: ${allowedEnvironments.join(", ")})`,
          });
          continue;
        }
        validated.push({ index: i, event: e });
      }

      // Batch dedup check: collect all client_event_ids, query once
      const clientEventIds = validated
        .map((v) => v.event.client_event_id)
        .filter((id): id is string => !!id);

      const existingIds = new Set<string>();
      if (clientEventIds.length > 0) {
        // Bound the dedup query to the last 48 hours so Postgres can prune
        // older partitions instead of scanning every month's index.
        const dedupHorizon = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const existing = await app.db
          .select({ client_event_id: events.client_event_id })
          .from(events)
          .where(
            and(
              eq(events.app_id, app_id),
              inArray(events.client_event_id, clientEventIds),
              gte(events.timestamp, dedupHorizon)
            )
          );
        for (const row of existing) {
          if (row.client_event_id) existingIds.add(row.client_event_id);
        }
      }

      const api_key_id = auth.type === "api_key" ? auth.key_id : null;
      const valid: Array<typeof events.$inferInsert> = [];
      for (const { event: e } of validated) {
        if (e.client_event_id && existingIds.has(e.client_event_id)) {
          continue;
        }
        valid.push(buildEventRow(e, app_id, api_key_id));
      }

      if (valid.length > 0) {
        await app.db.insert(events).values(valid);
        dualWriteSpecializedEvents(app.db, valid, api_key_id, request.log);
        upsertAppUsers(app.db, valid, appRow.project_id, app_id, request.log);
      }

      return {
        accepted: valid.length,
        rejected: errors.length,
        ...(errors.length > 0 ? { errors } : {}),
      };
    }
  );
}
