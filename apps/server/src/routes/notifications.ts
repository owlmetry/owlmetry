import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { notifications } from "@owlmetry/db";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  NOTIFICATION_TYPES,
  type NotificationsListQueryParams,
  type UpdateNotificationRequest,
  type MarkAllReadRequest,
} from "@owlmetry/shared";
import { requireAuth } from "../middleware/auth.js";
import { encodeKeysetCursor, decodeKeysetCursor } from "../utils/pagination.js";

function serializeNotification(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    data: (row.data ?? {}) as Record<string, unknown>,
    team_id: row.team_id,
    read_at: row.read_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

export async function notificationsRoutes(app: FastifyInstance) {
  // List
  app.get<{ Querystring: NotificationsListQueryParams }>(
    "/notifications",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Notifications are user-scoped — agent keys cannot list" });
      }
      const userId = request.auth.user_id;
      const { read_state, type, cursor, limit: rawLimit } = request.query ?? {};
      const limit = Math.min(Math.max(Number(rawLimit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

      const conditions = [
        eq(notifications.user_id, userId),
        isNull(notifications.deleted_at),
      ];
      if (read_state === "unread") conditions.push(isNull(notifications.read_at));
      else if (read_state === "read") conditions.push(sql`${notifications.read_at} IS NOT NULL`);

      if (type && (NOTIFICATION_TYPES as readonly string[]).includes(type)) {
        conditions.push(eq(notifications.type, type));
      }

      if (cursor) {
        const decoded = decodeKeysetCursor(cursor);
        if (decoded) {
          conditions.push(
            or(
              lt(notifications.created_at, new Date(decoded.timestamp)),
              and(
                eq(notifications.created_at, new Date(decoded.timestamp)),
                lt(notifications.id, decoded.id),
              ),
            )!,
          );
        }
      }

      const rows = await app.db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.created_at), desc(notifications.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeKeysetCursor(last.created_at, last.id) : null;

      return {
        notifications: page.map(serializeNotification),
        cursor: nextCursor,
        has_more: hasMore,
      };
    },
  );

  // Unread count
  app.get(
    "/notifications/unread-count",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Notifications are user-scoped" });
      }
      const [{ count }] = await app.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.user_id, request.auth.user_id),
            isNull(notifications.read_at),
            isNull(notifications.deleted_at),
          ),
        );
      return { count };
    },
  );

  // Mark all read
  app.post<{ Body: MarkAllReadRequest }>(
    "/notifications/mark-all-read",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Notifications are user-scoped" });
      }
      const conditions = [
        eq(notifications.user_id, request.auth.user_id),
        isNull(notifications.read_at),
        isNull(notifications.deleted_at),
      ];
      const type = request.body?.type;
      if (type && (NOTIFICATION_TYPES as readonly string[]).includes(type)) {
        conditions.push(eq(notifications.type, type));
      }
      const updated = await app.db
        .update(notifications)
        .set({ read_at: new Date() })
        .where(and(...conditions))
        .returning({ id: notifications.id });
      return { marked: updated.length };
    },
  );

  // Mark one notification (read or unread)
  app.patch<{ Params: { id: string }; Body: UpdateNotificationRequest }>(
    "/notifications/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Notifications are user-scoped" });
      }
      const [updated] = await app.db
        .update(notifications)
        .set({
          read_at: request.body?.read === false ? null : new Date(),
        })
        .where(
          and(
            eq(notifications.id, request.params.id),
            eq(notifications.user_id, request.auth.user_id),
            isNull(notifications.deleted_at),
          ),
        )
        .returning();
      if (!updated) return reply.code(404).send({ error: "Notification not found" });
      return { notification: serializeNotification(updated) };
    },
  );

  // Soft delete
  app.delete<{ Params: { id: string } }>(
    "/notifications/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Notifications are user-scoped" });
      }
      const [deleted] = await app.db
        .update(notifications)
        .set({ deleted_at: new Date() })
        .where(
          and(
            eq(notifications.id, request.params.id),
            eq(notifications.user_id, request.auth.user_id),
            isNull(notifications.deleted_at),
          ),
        )
        .returning({ id: notifications.id });
      if (!deleted) return reply.code(404).send({ error: "Notification not found" });
      return { id: deleted.id };
    },
  );
}
