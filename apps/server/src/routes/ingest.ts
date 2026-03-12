import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { events } from "@owlmetry/db";
import {
  MAX_BATCH_SIZE,
  MAX_META_VALUE_LENGTH,
  LOG_LEVELS,
} from "@owlmetry/shared";
import type { IngestRequest, EventPayload } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";

function validateEvent(
  e: EventPayload,
  index: number
): string | null {
  if (!e.body || typeof e.body !== "string") {
    return `events[${index}]: body is required and must be a string`;
  }
  if (!e.level || !LOG_LEVELS.includes(e.level as any)) {
    return `events[${index}]: level must be one of ${LOG_LEVELS.join(", ")}`;
  }
  return null;
}

function trimMeta(
  meta: Record<string, string> | undefined
): Record<string, string> | null {
  if (!meta) return null;
  const trimmed: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    trimmed[k] =
      typeof v === "string" && v.length > MAX_META_VALUE_LENGTH
        ? v.slice(0, MAX_META_VALUE_LENGTH)
        : String(v);
  }
  return trimmed;
}

export async function ingestRoutes(app: FastifyInstance) {
  app.post<{ Body: IngestRequest }>(
    "/ingest",
    { preHandler: [requirePermission("events:write"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      const { events: payloads } = request.body;

      if (!Array.isArray(payloads) || payloads.length === 0) {
        return reply.code(400).send({ error: "events array is required" });
      }

      if (payloads.length > MAX_BATCH_SIZE) {
        return reply
          .code(400)
          .send({ error: `Maximum batch size is ${MAX_BATCH_SIZE}` });
      }

      // Determine app_id
      const app_id =
        auth.type === "api_key" ? auth.app_id : null;

      if (!app_id) {
        return reply
          .code(400)
          .send({ error: "Client key must be scoped to an app" });
      }

      const errors: Array<{ index: number; message: string }> = [];
      const valid: Array<typeof events.$inferInsert> = [];

      for (let i = 0; i < payloads.length; i++) {
        const e = payloads[i];
        const err = validateEvent(e, i);
        if (err) {
          errors.push({ index: i, message: err });
          continue;
        }

        // Dedup by client_event_id if provided
        if (e.client_event_id) {
          const existing = await app.db
            .select({ id: events.id })
            .from(events)
            .where(
              and(
                eq(events.app_id, app_id),
                eq(events.client_event_id, e.client_event_id)
              )
            )
            .limit(1);

          if (existing.length > 0) {
            continue; // silently skip duplicate
          }
        }

        valid.push({
          app_id,
          client_event_id: e.client_event_id || null,
          user_identifier: e.user_identifier || null,
          level: e.level,
          source: e.source || null,
          body: e.body,
          context: e.context || null,
          meta: trimMeta(e.meta),
          platform: e.platform || null,
          os_version: e.os_version || null,
          app_version: e.app_version || null,
          device_model: e.device_model || null,
          build_number: e.build_number || null,
          locale: e.locale || null,
          timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
        });
      }

      if (valid.length > 0) {
        await app.db.insert(events).values(valid);
      }

      return {
        accepted: valid.length,
        rejected: errors.length,
        ...(errors.length > 0 ? { errors } : {}),
      };
    }
  );
}
