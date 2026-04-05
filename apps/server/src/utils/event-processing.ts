import { sql } from "drizzle-orm";
import type { Db } from "@owlmetry/db";
import { events, appUsers, appUserApps, metricEvents, funnelEvents } from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX, parseMetricMessage, parseFunnelStepMessage } from "@owlmetry/shared";
import {
  MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH,
  LOG_LEVELS,
} from "@owlmetry/shared";
import type { IngestEventPayload } from "@owlmetry/shared";
import type { FastifyBaseLogger } from "fastify";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate common event fields (message, level, session_id, timestamp format, future check).
 * If `maxAgeDays` is provided, also rejects timestamps older than that many days.
 */
export function validateEventPayload(
  payload: IngestEventPayload,
  index: number,
  options?: { maxAgeDays?: number }
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
    if (options?.maxAgeDays !== undefined) {
      if (parsed.getTime() < now - options.maxAgeDays * 24 * 60 * 60 * 1000) {
        return `events[${index}]: timestamp cannot be more than ${options.maxAgeDays} days in the past`;
      }
    }
  }
  return null;
}

export function truncateCustomAttributes(
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

export function buildEventRow(
  e: IngestEventPayload,
  app_id: string,
  api_key_id: string | null,
): typeof events.$inferInsert {
  return {
    app_id,
    client_event_id: e.client_event_id || null,
    session_id: e.session_id,
    user_id: e.user_id || null,
    api_key_id,
    level: e.level,
    source_module: e.source_module || null,
    message: e.message,
    screen_name: e.screen_name || null,
    custom_attributes: truncateCustomAttributes(e.custom_attributes),
    environment: e.environment || null,
    os_version: e.os_version || null,
    app_version: e.app_version || null,
    device_model: e.device_model || null,
    build_number: e.build_number || null,
    locale: e.locale || null,
    is_dev: e.is_dev ?? false,
    experiments: e.experiments || null,
    timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
  };
}

export function buildMetricRows(
  validEvents: Array<typeof events.$inferInsert>,
  api_key_id: string | null,
): Array<typeof metricEvents.$inferInsert> {
  const rows: Array<typeof metricEvents.$inferInsert> = [];
  for (const ev of validEvents) {
    const parsed = parseMetricMessage(ev.message);
    if (!parsed) continue;

    const attrs = ev.custom_attributes ?? {};
    const trackingId = attrs.tracking_id && UUID_REGEX.test(attrs.tracking_id)
      ? attrs.tracking_id
      : null;
    rows.push({
      app_id: ev.app_id,
      session_id: ev.session_id,
      user_id: ev.user_id ?? null,
      api_key_id,
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
  return rows;
}

export function buildFunnelRows(
  validEvents: Array<typeof events.$inferInsert>,
  api_key_id: string | null,
): Array<typeof funnelEvents.$inferInsert> {
  const rows: Array<typeof funnelEvents.$inferInsert> = [];
  for (const ev of validEvents) {
    // Accepts both "step:" (new) and legacy "track:" prefixed messages from older clients
    const stepName = parseFunnelStepMessage(ev.message);
    if (!stepName) continue;

    rows.push({
      app_id: ev.app_id,
      session_id: ev.session_id,
      user_id: ev.user_id ?? null,
      api_key_id,
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
  return rows;
}

/** Fire-and-forget dual-write to metric_events and funnel_events. */
export function dualWriteSpecializedEvents(
  db: Db,
  validEvents: Array<typeof events.$inferInsert>,
  api_key_id: string | null,
  log: FastifyBaseLogger,
) {
  const metricRows = buildMetricRows(validEvents, api_key_id);
  if (metricRows.length > 0) {
    db.insert(metricEvents)
      .values(metricRows)
      .execute()
      .catch((err) => {
        log.warn({ err }, "Failed to dual-write metric events");
      });
  }

  const funnelRows = buildFunnelRows(validEvents, api_key_id);
  if (funnelRows.length > 0) {
    db.insert(funnelEvents)
      .values(funnelRows)
      .execute()
      .catch((err) => {
        log.warn({ err }, "Failed to dual-write funnel events");
      });
  }
}

/** Fire-and-forget upsert of project-scoped app_users + junction entries. */
export function upsertAppUsers(
  db: Db,
  validEvents: Array<typeof events.$inferInsert>,
  project_id: string,
  app_id: string,
  log: FastifyBaseLogger,
) {
  const uniqueUserIds = [...new Set(
    validEvents.map((e) => e.user_id).filter((id): id is string => !!id)
  )];
  if (uniqueUserIds.length === 0) return;

  const userRows = uniqueUserIds.map((uid) => ({
    project_id,
    user_id: uid,
    is_anonymous: uid.startsWith(ANONYMOUS_ID_PREFIX),
  }));
  db.insert(appUsers)
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
      return db
        .insert(appUserApps)
        .values(junctionRows)
        .onConflictDoUpdate({
          target: [appUserApps.app_user_id, appUserApps.app_id],
          set: { last_seen_at: sql`NOW()` },
        })
        .execute();
    })
    .catch((err) => {
      log.warn({ err }, "Failed to upsert app_users");
    });
}
