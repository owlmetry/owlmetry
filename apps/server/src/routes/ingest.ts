import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { events } from "@owlmetry/db";
import {
  MAX_BATCH_SIZE,
  MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH,
  LOG_LEVELS,
} from "@owlmetry/shared";
import type { IngestRequest, IngestEventPayload } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";

function validateIngestEventPayload(
  payload: IngestEventPayload,
  index: number
): string | null {
  if (!payload.message || typeof payload.message !== "string") {
    return `events[${index}]: message is required and must be a string`;
  }
  if (!payload.level || !LOG_LEVELS.includes(payload.level as any)) {
    return `events[${index}]: level must be one of ${LOG_LEVELS.join(", ")}`;
  }
  return null;
}

function truncateCustomAttributeValues(
  customAttributes: Record<string, string> | undefined
): Record<string, string> | null {
  if (!customAttributes) return null;
  const truncated: Record<string, string> = {};
  for (const [k, v] of Object.entries(customAttributes)) {
    truncated[k] =
      typeof v === "string" && v.length > MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH
        ? v.slice(0, MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH)
        : String(v);
  }
  return truncated;
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
      const validated: Array<{ index: number; event: IngestEventPayload }> = [];

      for (let i = 0; i < payloads.length; i++) {
        const e = payloads[i];
        const err = validateIngestEventPayload(e, i);
        if (err) {
          errors.push({ index: i, message: err });
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
        const existing = await app.db
          .select({ client_event_id: events.client_event_id })
          .from(events)
          .where(
            and(
              eq(events.app_id, app_id),
              inArray(events.client_event_id, clientEventIds)
            )
          );
        for (const row of existing) {
          if (row.client_event_id) existingIds.add(row.client_event_id);
        }
      }

      const valid: Array<typeof events.$inferInsert> = [];
      for (const { event: e } of validated) {
        if (e.client_event_id && existingIds.has(e.client_event_id)) {
          continue; // silently skip duplicate
        }

        valid.push({
          app_id,
          client_event_id: e.client_event_id || null,
          user_id: e.user_id || null,
          level: e.level,
          source_module: e.source_module || null,
          message: e.message,
          screen_name: e.screen_name || null,
          custom_attributes: truncateCustomAttributeValues(e.custom_attributes),
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
