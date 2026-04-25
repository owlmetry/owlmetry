import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { notifications } from "@owlmetry/db";
import {
  NOTIFICATION_TYPES,
  type NotificationsListQueryParams,
  type UpdateNotificationRequest,
  type MarkAllReadRequest,
} from "@owlmetry/shared";
import { requireUser, userAuth } from "../middleware/auth.js";
import { encodeKeysetCursor, decodeKeysetCursor, normalizeLimit } from "../utils/pagination.js";

function serializeNotification(row: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  team_id: string | null;
  read_at: Date | null;
  created_at: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    team_id: row.team_id,
    read_at: row.read_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

export async function notificationsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: NotificationsListQueryParams }>(
    "/notifications",
    { preHandler: requireUser },
    async (request) => {
      const userId = userAuth(request).user_id;
      const { read_state, type, cursor, limit } = request.query ?? {};

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

      const pageSize = normalizeLimit(limit);
      // Skip the `data` jsonb in list — issue digests can carry kilobytes of
      // structured data per row. List view only needs the pre-rendered text.
      const rows = await app.db
        .select({
          id: notifications.id,
          type: notifications.type,
          title: notifications.title,
          body: notifications.body,
          link: notifications.link,
          team_id: notifications.team_id,
          read_at: notifications.read_at,
          created_at: notifications.created_at,
        })
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.created_at), desc(notifications.id))
        .limit(pageSize + 1);

      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeKeysetCursor(last.created_at, last.id) : null;

      return {
        notifications: page.map(serializeNotification),
        cursor: nextCursor,
        has_more: hasMore,
      };
    },
  );

  app.get(
    "/notifications/unread-count",
    { preHandler: requireUser },
    async (request) => {
      const [{ count }] = await app.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.user_id, userAuth(request).user_id),
            isNull(notifications.read_at),
            isNull(notifications.deleted_at),
          ),
        );
      return { count };
    },
  );

  app.post<{ Body: MarkAllReadRequest }>(
    "/notifications/mark-all-read",
    { preHandler: requireUser },
    async (request) => {
      const conditions = [
        eq(notifications.user_id, userAuth(request).user_id),
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

  app.patch<{ Params: { id: string }; Body: UpdateNotificationRequest }>(
    "/notifications/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const [updated] = await app.db
        .update(notifications)
        .set({
          read_at: request.body?.read === false ? null : new Date(),
        })
        .where(
          and(
            eq(notifications.id, request.params.id),
            eq(notifications.user_id, userAuth(request).user_id),
            isNull(notifications.deleted_at),
          ),
        )
        .returning();
      if (!updated) return reply.code(404).send({ error: "Notification not found" });
      return { notification: serializeNotification(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/notifications/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const [deleted] = await app.db
        .update(notifications)
        .set({ deleted_at: new Date() })
        .where(
          and(
            eq(notifications.id, request.params.id),
            eq(notifications.user_id, userAuth(request).user_id),
            isNull(notifications.deleted_at),
          ),
        )
        .returning({ id: notifications.id });
      if (!deleted) return reply.code(404).send({ error: "Notification not found" });
      return { id: deleted.id };
    },
  );
}
