import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, lt, gt, desc, asc, inArray, isNull } from "drizzle-orm";
import { events, apps } from "@owlmetry/db";
import { parseTimeParam } from "@owlmetry/shared";
import type { EventsQueryParams } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds, hasTeamAccess } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { normalizeLimit } from "../utils/pagination.js";
import { dataModeToDrizzle } from "../utils/data-mode.js";

export async function eventsRoutes(app: FastifyInstance) {
  // Query events
  app.get<{ Querystring: EventsQueryParams }>(
    "/events",
    { preHandler: [requirePermission("events:read"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);

      const {
        team_id,
        project_id,
        app_id,
        level,
        user_id,
        session_id,
        environment,
        screen_name,
        since,
        until,
        cursor,
        limit: rawLimit,
        data_mode,
        order: rawOrder,
      } = request.query;

      const limit = normalizeLimit(rawLimit);
      const isAsc = rawOrder === "asc";

      // If team_id is specified, validate access and scope to that team
      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { events: [], cursor: null, has_more: false };
      }

      const conditions = [];

      if (app_id) {
        // Verify the requested app belongs to one of the user's teams
        const [appRow] = await app.db
          .select({ id: apps.id })
          .from(apps)
          .where(
            and(eq(apps.id, app_id), inArray(apps.team_id, teamIds), isNull(apps.deleted_at))
          )
          .limit(1);
        if (!appRow) {
          return { events: [], cursor: null, has_more: false };
        }
        conditions.push(eq(events.app_id, app_id));
      } else if (project_id) {
        // Filter to apps within the specified project
        const projectApps = await app.db
          .select({ id: apps.id })
          .from(apps)
          .where(
            and(eq(apps.project_id, project_id), inArray(apps.team_id, teamIds), isNull(apps.deleted_at))
          );
        const projectAppIds = projectApps.map((a) => a.id);
        if (projectAppIds.length === 0) {
          return { events: [], cursor: null, has_more: false };
        }
        conditions.push(inArray(events.app_id, projectAppIds));
      } else {
        // Scope to all apps the user has access to
        const teamApps = await app.db
          .select({ id: apps.id })
          .from(apps)
          .where(and(inArray(apps.team_id, teamIds), isNull(apps.deleted_at)));
        const teamAppIds = teamApps.map((a) => a.id);
        if (teamAppIds.length === 0) {
          return { events: [], cursor: null, has_more: false };
        }
        conditions.push(inArray(events.app_id, teamAppIds));
      }

      const devCondition = dataModeToDrizzle(events.is_dev, data_mode);
      if (devCondition) conditions.push(devCondition);

      if (level) {
        conditions.push(eq(events.level, level as any));
      }
      if (user_id) {
        conditions.push(eq(events.user_id, user_id));
      }
      if (session_id) {
        conditions.push(eq(events.session_id, session_id));
      }
      if (environment) {
        conditions.push(eq(events.environment, environment as any));
      }
      if (screen_name) {
        conditions.push(eq(events.screen_name, screen_name));
      }
      if (since) {
        conditions.push(gte(events.timestamp, parseTimeParam(since)));
      }
      if (until) {
        conditions.push(lte(events.timestamp, parseTimeParam(until)));
      }
      if (cursor) {
        const cursorDate = new Date(cursor);
        conditions.push(isAsc ? gt(events.timestamp, cursorDate) : lt(events.timestamp, cursorDate));
      }

      const rows = await app.db
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(isAsc ? asc(events.timestamp) : desc(events.timestamp))
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

      // Verify event belongs to an app the user has access to
      const [eventApp] = await app.db
        .select({ team_id: apps.team_id, project_id: apps.project_id })
        .from(apps)
        .where(and(eq(apps.id, event.app_id), isNull(apps.deleted_at)))
        .limit(1);

      if (!eventApp || !hasTeamAccess(auth, eventApp.team_id)) {
        return reply.code(404).send({ error: "Event not found" });
      }

      return {
        ...event,
        project_id: eventApp.project_id,
        timestamp: event.timestamp.toISOString(),
        received_at: event.received_at.toISOString(),
      };
    }
  );
}
