import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, inArray, isNull } from "drizzle-orm";
import postgres from "postgres";
import { apps, events, metricEvents, funnelEvents, ensurePartitionsForDates } from "@owlmetry/db";
import {
  MAX_IMPORT_BATCH_SIZE,
  ALLOWED_ENVIRONMENTS_FOR_PLATFORM,
} from "@owlmetry/shared";
import type { IngestRequest, IngestEventPayload } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import {
  validateEventPayload,
  buildEventRow,
  dualWriteSpecializedEvents,
  upsertAppUsers,
} from "../utils/event-processing.js";

export async function importRoutes(app: FastifyInstance) {
  let partitionClient: postgres.Sql | null = null;

  function getPartitionClient(): postgres.Sql {
    if (!partitionClient) {
      partitionClient = postgres(app.databaseUrl, { max: 2 });
    }
    return partitionClient;
  }

  app.addHook("onClose", async () => {
    if (partitionClient) {
      await partitionClient.end();
      partitionClient = null;
    }
  });

  app.post<{ Body: IngestRequest }>(
    "/import",
    { preHandler: [requirePermission("events:write")] },
    async (request, reply) => {
      const auth = request.auth;

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
        const err = validateEventPayload(e, i);
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

      // Find existing events by client_event_id (timestamp-bounded for partition pruning)
      const clientEventIds = validated
        .map((v) => v.event.client_event_id)
        .filter((id): id is string => !!id);

      const existingIds = new Set<string>();
      if (clientEventIds.length > 0) {
        const batchTimestamps = validated
          .filter((v) => v.event.client_event_id)
          .map((v) => v.event.timestamp ? new Date(v.event.timestamp).getTime() : Date.now());
        const minTs = new Date(Math.min(...batchTimestamps));
        const maxTs = new Date(Math.max(...batchTimestamps));

        const existing = await app.db
          .select({ client_event_id: events.client_event_id })
          .from(events)
          .where(
            and(
              eq(events.app_id, app_id),
              inArray(events.client_event_id, clientEventIds),
              gte(events.timestamp, minTs),
              lte(events.timestamp, maxTs)
            )
          );
        for (const row of existing) {
          if (row.client_event_id) existingIds.add(row.client_event_id);
        }
      }

      // Split into new inserts and updates for existing events
      const newRows: Array<typeof events.$inferInsert> = [];
      const updateRows: Array<typeof events.$inferInsert> = [];
      for (const { event: e } of validated) {
        const row = buildEventRow(e, app_id, auth.key_id);
        if (e.client_event_id && existingIds.has(e.client_event_id)) {
          updateRows.push(row);
        } else {
          newRows.push(row);
        }
      }

      const allRows = [...newRows, ...updateRows];

      if (allRows.length > 0) {
        const timestamps = allRows.map((e) => e.timestamp as Date);
        await ensurePartitionsForDates(getPartitionClient(), timestamps);
      }

      // Insert new events
      if (newRows.length > 0) {
        await app.db.insert(events).values(newRows);
        dualWriteSpecializedEvents(app.db, newRows, auth.key_id, request.log);
      }

      // Update existing events (all mutable fields)
      if (updateRows.length > 0) {
        await Promise.all(updateRows.map((ev) =>
          app.db
            .update(events)
            .set({
              session_id: ev.session_id,
              user_id: ev.user_id,
              level: ev.level,
              source_module: ev.source_module,
              message: ev.message,
              screen_name: ev.screen_name,
              custom_attributes: ev.custom_attributes,
              environment: ev.environment,
              os_version: ev.os_version,
              app_version: ev.app_version,
              device_model: ev.device_model,
              build_number: ev.build_number,
              locale: ev.locale,
              is_dev: ev.is_dev,
              experiments: ev.experiments,
            })
            .where(
              and(
                eq(events.app_id, app_id),
                eq(events.client_event_id, ev.client_event_id!),
              )
            )
        ));

        // Update metric_events and funnel_events for changed events.
        // Delete old rows and re-insert so message changes (e.g. non-metric → metric) are handled.
        const updateClientIds = updateRows
          .map((r) => r.client_event_id)
          .filter((id): id is string => !!id);

        app.db
          .delete(metricEvents)
          .where(and(
            eq(metricEvents.app_id, app_id),
            inArray(metricEvents.client_event_id, updateClientIds),
          ))
          .execute()
          .then(() =>
            app.db
              .delete(funnelEvents)
              .where(and(
                eq(funnelEvents.app_id, app_id),
                inArray(funnelEvents.client_event_id, updateClientIds),
              ))
              .execute()
          )
          .then(() => {
            dualWriteSpecializedEvents(app.db, updateRows, auth.key_id, request.log);
          })
          .catch((err) => {
            request.log.warn({ err }, "Failed to update metric/funnel events for import");
          });
      }

      // Upsert users for all events (new + updated)
      if (allRows.length > 0) {
        upsertAppUsers(app.db, allRows, appRow.project_id, app_id, request.log);
      }

      return {
        accepted: newRows.length,
        updated: updateRows.length,
        rejected: errors.length,
        ...(errors.length > 0 ? { errors } : {}),
      };
    }
  );
}
