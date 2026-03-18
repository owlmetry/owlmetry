import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { apps, events, appUsers, metricEvents } from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX, parseMetricMessage } from "@owlmetry/shared";
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
  if (!payload.session_id || typeof payload.session_id !== "string") {
    return `events[${index}]: session_id is required and must be a string`;
  }
  if (payload.timestamp) {
    const parsed = new Date(payload.timestamp);
    if (isNaN(parsed.getTime())) {
      return `events[${index}]: timestamp must be a valid ISO 8601 date`;
    }
    const now = Date.now();
    if (parsed.getTime() > now + 5 * 60_000) {
      return `events[${index}]: timestamp cannot be more than 5 minutes in the future`;
    }
    if (parsed.getTime() < now - 30 * 24 * 60 * 60 * 1000) {
      return `events[${index}]: timestamp cannot be more than 30 days in the past`;
    }
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
      const { bundle_id, events: payloads } = request.body;

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
          .send({ error: "API key must be scoped to an app" });
      }

      // Look up the app to validate bundle_id (if applicable)
      const [appRow] = await app.db
        .select({ bundle_id: apps.bundle_id })
        .from(apps)
        .where(and(eq(apps.id, app_id), isNull(apps.deleted_at)))
        .limit(1);

      if (!appRow) {
        return reply
          .code(400)
          .send({ error: "App associated with this API key no longer exists" });
      }

      // Server apps (no bundle_id on the app) skip bundle_id validation;
      // client apps require a matching bundle_id in the request
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
          session_id: e.session_id,
          user_id: e.user_id || null,
          level: e.level,
          source_module: e.source_module || null,
          message: e.message,
          screen_name: e.screen_name || null,
          custom_attributes: truncateCustomAttributeValues(e.custom_attributes),
          environment: e.environment || null,
          os_version: e.os_version || null,
          app_version: e.app_version || null,
          device_model: e.device_model || null,
          build_number: e.build_number || null,
          locale: e.locale || null,
          is_debug: e.is_debug ?? false,
          timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
        });
      }

      if (valid.length > 0) {
        await app.db.insert(events).values(valid);

        // Dual-write: detect metric events and insert into metric_events table
        const metricRows: Array<typeof metricEvents.$inferInsert> = [];
        for (const ev of valid) {
          const parsed = parseMetricMessage(ev.message);
          if (!parsed) continue;

          const attrs = ev.custom_attributes ?? {};
          metricRows.push({
            app_id: ev.app_id,
            session_id: ev.session_id,
            user_id: ev.user_id ?? null,
            metric_slug: parsed.slug,
            phase: parsed.phase,
            tracking_id: attrs.tracking_id || null,
            duration_ms: attrs.duration_ms ? parseInt(attrs.duration_ms, 10) || null : null,
            error: attrs.error || null,
            attributes: attrs,
            environment: ev.environment ?? null,
            os_version: ev.os_version ?? null,
            app_version: ev.app_version ?? null,
            device_model: ev.device_model ?? null,
            build_number: ev.build_number ?? null,
            is_debug: ev.is_debug ?? false,
            client_event_id: ev.client_event_id || null,
            timestamp: ev.timestamp as Date,
          });
        }

        if (metricRows.length > 0) {
          // Fire-and-forget: metric_events write failure should not block event ingest
          app.db
            .insert(metricEvents)
            .values(metricRows)
            .execute()
            .catch((err) => {
              request.log.warn({ err }, "Failed to dual-write metric events");
            });
        }

        // Fire-and-forget: upsert app_users for each unique user_id in the batch
        const uniqueUserIds = [...new Set(valid.map((e) => e.user_id).filter((id): id is string => !!id))];
        if (uniqueUserIds.length > 0) {
          const userRows = uniqueUserIds.map((uid) => ({
            app_id,
            user_id: uid,
            is_anonymous: uid.startsWith(ANONYMOUS_ID_PREFIX),
          }));
          app.db
            .insert(appUsers)
            .values(userRows)
            .onConflictDoUpdate({
              target: [appUsers.app_id, appUsers.user_id],
              set: { last_seen_at: sql`NOW()` },
            })
            .execute()
            .catch((err) => {
              request.log.warn({ err }, "Failed to upsert app_users");
            });
        }
      }

      return {
        accepted: valid.length,
        rejected: errors.length,
        ...(errors.length > 0 ? { errors } : {}),
      };
    }
  );
}
