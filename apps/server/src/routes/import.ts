import type { FastifyInstance } from "fastify";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import postgres from "postgres";
import { apps, events, appUsers, appUserApps, metricEvents, funnelEvents, ensurePartitionsForDates } from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX, parseMetricMessage, parseTrackMessage } from "@owlmetry/shared";
import {
  MAX_IMPORT_BATCH_SIZE,
  MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH,
  LOG_LEVELS,
  ALLOWED_ENVIRONMENTS_FOR_PLATFORM,
} from "@owlmetry/shared";
import type { ImportRequest, IngestEventPayload } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateImportEventPayload(
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
    // Import allows any historical timestamp but still rejects future timestamps
    const now = Date.now();
    if (parsed.getTime() > now + 5 * 60_000) {
      return `events[${index}]: timestamp cannot be more than 5 minutes in the future`;
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

export async function importRoutes(app: FastifyInstance) {
  app.post<{ Body: ImportRequest }>(
    "/import",
    { preHandler: [requirePermission("events:write")] },
    async (request, reply) => {
      const auth = request.auth;

      // Only import keys can use this endpoint
      if (auth.type !== "api_key" || auth.key_type !== "import") {
        return reply.code(403).send({ error: "This endpoint requires an import API key (owl_import_*)" });
      }

      const { events: payloads } = request.body;

      if (!Array.isArray(payloads) || payloads.length === 0) {
        return reply.code(400).send({ error: "events array is required" });
      }

      if (payloads.length > MAX_IMPORT_BATCH_SIZE) {
        return reply
          .code(400)
          .send({ error: `Maximum import batch size is ${MAX_IMPORT_BATCH_SIZE}` });
      }

      const app_id = auth.app_id;

      if (!app_id) {
        return reply
          .code(400)
          .send({ error: "API key must be scoped to an app" });
      }

      // Look up the app (no bundle_id validation for import)
      const [appRow] = await app.db
        .select({ platform: apps.platform, project_id: apps.project_id })
        .from(apps)
        .where(and(eq(apps.id, app_id), isNull(apps.deleted_at)))
        .limit(1);

      if (!appRow) {
        return reply
          .code(400)
          .send({ error: "App associated with this API key no longer exists" });
      }

      const errors: Array<{ index: number; message: string }> = [];
      const validated: Array<{ index: number; event: IngestEventPayload }> = [];
      const allowedEnvironments = ALLOWED_ENVIRONMENTS_FOR_PLATFORM[
        appRow.platform as keyof typeof ALLOWED_ENVIRONMENTS_FOR_PLATFORM
      ];

      for (let i = 0; i < payloads.length; i++) {
        const e = payloads[i];
        const err = validateImportEventPayload(e, i);
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

      // Batch dedup check: collect all client_event_ids, query once.
      // Unlike /v1/ingest which uses a 48h dedup horizon for performance,
      // import checks across all time so re-running an import script is safe.
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
          api_key_id: auth.key_id,
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
          is_dev: e.is_dev ?? false,
          experiments: e.experiments || null,
          timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
        });
      }

      if (valid.length > 0) {
        // Ensure partitions exist for all months covered by imported events
        const timestamps = valid.map((e) => e.timestamp as Date);
        const client = postgres(app.databaseUrl, { max: 1 });
        try {
          await ensurePartitionsForDates(client, timestamps);
        } finally {
          await client.end();
        }

        await app.db.insert(events).values(valid);

        // Dual-write: detect metric events and insert into metric_events table
        const metricRows: Array<typeof metricEvents.$inferInsert> = [];
        for (const ev of valid) {
          const parsed = parseMetricMessage(ev.message);
          if (!parsed) continue;

          const attrs = ev.custom_attributes ?? {};
          const trackingId = attrs.tracking_id && UUID_REGEX.test(attrs.tracking_id)
            ? attrs.tracking_id
            : null;
          metricRows.push({
            app_id: ev.app_id,
            session_id: ev.session_id,
            user_id: ev.user_id ?? null,
            api_key_id: auth.key_id,
            metric_slug: parsed.slug,
            phase: parsed.phase,
            tracking_id: trackingId,
            duration_ms: attrs.duration_ms ? parseInt(attrs.duration_ms, 10) || null : null,
            error: attrs.error || null,
            attributes: attrs,
            environment: ev.environment ?? null,
            os_version: ev.os_version ?? null,
            app_version: ev.app_version ?? null,
            device_model: ev.device_model ?? null,
            build_number: ev.build_number ?? null,
            is_dev: ev.is_dev ?? false,
            client_event_id: ev.client_event_id || null,
            timestamp: ev.timestamp as Date,
          });
        }

        if (metricRows.length > 0) {
          app.db
            .insert(metricEvents)
            .values(metricRows)
            .execute()
            .catch((err) => {
              request.log.warn({ err }, "Failed to dual-write metric events");
            });
        }

        // Dual-write: detect track events and insert into funnel_events table
        const funnelRows: Array<typeof funnelEvents.$inferInsert> = [];
        for (const ev of valid) {
          const stepName = parseTrackMessage(ev.message);
          if (!stepName) continue;

          funnelRows.push({
            app_id: ev.app_id,
            session_id: ev.session_id,
            user_id: ev.user_id ?? null,
            api_key_id: auth.key_id,
            step_name: stepName,
            message: ev.message,
            screen_name: ev.screen_name ?? null,
            custom_attributes: ev.custom_attributes ?? null,
            experiments: ev.experiments ?? null,
            environment: ev.environment ?? null,
            os_version: ev.os_version ?? null,
            app_version: ev.app_version ?? null,
            device_model: ev.device_model ?? null,
            build_number: ev.build_number ?? null,
            is_dev: ev.is_dev ?? false,
            client_event_id: ev.client_event_id || null,
            timestamp: ev.timestamp as Date,
          });
        }

        if (funnelRows.length > 0) {
          app.db
            .insert(funnelEvents)
            .values(funnelRows)
            .execute()
            .catch((err) => {
              request.log.warn({ err }, "Failed to dual-write funnel events");
            });
        }

        // Fire-and-forget: upsert app_users (project-scoped) + junction entries
        const uniqueUserIds = [...new Set(valid.map((e) => e.user_id).filter((id): id is string => !!id))];
        if (uniqueUserIds.length > 0) {
          const project_id = appRow.project_id;
          const userRows = uniqueUserIds.map((uid) => ({
            project_id,
            user_id: uid,
            is_anonymous: uid.startsWith(ANONYMOUS_ID_PREFIX),
          }));
          app.db
            .insert(appUsers)
            .values(userRows)
            .onConflictDoUpdate({
              target: [appUsers.project_id, appUsers.user_id],
              set: { last_seen_at: sql`NOW()` },
            })
            .returning({ id: appUsers.id, user_id: appUsers.user_id })
            .then((upserted) => {
              const junctionRows = upserted.map((u) => ({
                app_user_id: u.id,
                app_id,
              }));
              return app.db
                .insert(appUserApps)
                .values(junctionRows)
                .onConflictDoUpdate({
                  target: [appUserApps.app_user_id, appUserApps.app_id],
                  set: { last_seen_at: sql`NOW()` },
                })
                .execute();
            })
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
