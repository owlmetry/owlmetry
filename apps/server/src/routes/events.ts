import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, lt, desc, sql } from "drizzle-orm";
import { events } from "@owlmetry/db";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@owlmetry/shared";
import type { EventsQueryParams } from "@owlmetry/shared";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";

export async function eventsRoutes(app: FastifyInstance) {
  // Query events
  app.get<{ Querystring: EventsQueryParams }>(
    "/events",
    { preHandler: [requireAuth, rateLimit] },
    async (request, reply) => {
      const auth = request.auth;

      // Check read permission for API keys
      if (
        auth.type === "api_key" &&
        !auth.permissions.includes("events:read")
      ) {
        return reply.code(403).send({ error: "Missing permission: events:read" });
      }

      const {
        app_id,
        level,
        user,
        context,
        since,
        until,
        cursor,
        limit: rawLimit,
      } = request.query;

      const limit = Math.min(
        Math.max(Number(rawLimit) || DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE
      );

      const conditions = [];

      // Scope to team's apps
      if (app_id) {
        conditions.push(eq(events.app_id, app_id));
      }
      if (level) {
        conditions.push(eq(events.level, level as any));
      }
      if (user) {
        conditions.push(eq(events.user_identifier, user));
      }
      if (context) {
        conditions.push(eq(events.context, context));
      }
      if (since) {
        conditions.push(gte(events.timestamp, new Date(since)));
      }
      if (until) {
        conditions.push(lte(events.timestamp, new Date(until)));
      }
      if (cursor) {
        // cursor is ISO timestamp of last event
        conditions.push(lt(events.timestamp, new Date(cursor)));
      }

      const rows = await app.db
        .select()
        .from(events)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(events.timestamp))
        .limit(limit + 1);

      const has_more = rows.length > limit;
      const page = has_more ? rows.slice(0, limit) : rows;

      return {
        events: page.map((e) => ({
          ...e,
          timestamp: e.timestamp.toISOString(),
          received_at: e.received_at.toISOString(),
        })),
        cursor: has_more
          ? page[page.length - 1].timestamp.toISOString()
          : null,
        has_more,
      };
    }
  );

  // Single event
  app.get<{ Params: { id: string } }>(
    "/events/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const auth = request.auth;
      if (
        auth.type === "api_key" &&
        !auth.permissions.includes("events:read")
      ) {
        return reply.code(403).send({ error: "Missing permission: events:read" });
      }

      const { id } = request.params;

      const [event] = await app.db
        .select()
        .from(events)
        .where(eq(events.id, id))
        .limit(1);

      if (!event) {
        return reply.code(404).send({ error: "Event not found" });
      }

      return {
        ...event,
        timestamp: event.timestamp.toISOString(),
        received_at: event.received_at.toISOString(),
      };
    }
  );
}
