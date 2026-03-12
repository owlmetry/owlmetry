import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, lt, desc, inArray } from "drizzle-orm";
import { events, apps } from "@owlmetry/db";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@owlmetry/shared";
import type { EventsQueryParams } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";

export async function eventsRoutes(app: FastifyInstance) {
  // Query events
  app.get<{ Querystring: EventsQueryParams }>(
    "/events",
    { preHandler: [requirePermission("events:read"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;

      const {
        project_id,
        app_id,
        level,
        user,
        screen_name,
        since,
        until,
        cursor,
        limit: rawLimit,
      } = request.query;

      const limit = Math.min(
        Math.max(Number(rawLimit) || DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE
      );

      // Scope to team's apps
      const teamApps = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(eq(apps.team_id, auth.team_id));
      const teamAppIds = teamApps.map((a) => a.id);

      if (teamAppIds.length === 0) {
        return { events: [], cursor: null, has_more: false };
      }

      const conditions = [];

      if (app_id) {
        // Verify the requested app belongs to the team
        if (!teamAppIds.includes(app_id)) {
          return { events: [], cursor: null, has_more: false };
        }
        conditions.push(eq(events.app_id, app_id));
      } else if (project_id) {
        // Filter to apps within the specified project
        const projectApps = await app.db
          .select({ id: apps.id })
          .from(apps)
          .where(
            and(eq(apps.project_id, project_id), eq(apps.team_id, auth.team_id))
          );
        const projectAppIds = projectApps.map((a) => a.id);
        if (projectAppIds.length === 0) {
          return { events: [], cursor: null, has_more: false };
        }
        conditions.push(inArray(events.app_id, projectAppIds));
      } else {
        conditions.push(inArray(events.app_id, teamAppIds));
      }

      if (level) {
        conditions.push(eq(events.level, level as any));
      }
      if (user) {
        conditions.push(eq(events.user_id, user));
      }
      if (screen_name) {
        conditions.push(eq(events.screen_name, screen_name));
      }
      if (since) {
        conditions.push(gte(events.timestamp, new Date(since)));
      }
      if (until) {
        conditions.push(lte(events.timestamp, new Date(until)));
      }
      if (cursor) {
        conditions.push(lt(events.timestamp, new Date(cursor)));
      }

      const rows = await app.db
        .select()
        .from(events)
        .where(and(...conditions))
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
    { preHandler: [requirePermission("events:read")] },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;

      const [event] = await app.db
        .select()
        .from(events)
        .where(eq(events.id, id))
        .limit(1);

      if (!event) {
        return reply.code(404).send({ error: "Event not found" });
      }

      // Verify event belongs to team's app
      const [eventApp] = await app.db
        .select({ team_id: apps.team_id })
        .from(apps)
        .where(eq(apps.id, event.app_id))
        .limit(1);

      if (!eventApp || eventApp.team_id !== auth.team_id) {
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
