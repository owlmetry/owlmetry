import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, lt, desc, inArray, isNull, ilike } from "drizzle-orm";
import { apps, appUsers } from "@owlmetry/db";
import type { AppUsersQueryParams, TeamAppUsersQueryParams } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { serializeAppUser } from "../utils/serialize.js";
import { normalizeLimit } from "../utils/pagination.js";

export async function appUsersRoutes(app: FastifyInstance) {
  // Per-app user listing
  app.get<{ Params: { id: string }; Querystring: AppUsersQueryParams }>(
    "/apps/:id/users",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;
      const { search, is_anonymous, cursor, limit: rawLimit } = request.query;

      const limit = normalizeLimit(rawLimit);

      // Verify app exists and belongs to caller's team
      const teamIds = getAuthTeamIds(auth);
      const [appRow] = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(
          and(eq(apps.id, id), inArray(apps.team_id, teamIds), isNull(apps.deleted_at))
        )
        .limit(1);

      if (!appRow) {
        return reply.code(404).send({ error: "App not found" });
      }

      const conditions = [eq(appUsers.app_id, id)];

      if (is_anonymous === "true") {
        conditions.push(eq(appUsers.is_anonymous, true));
      } else if (is_anonymous === "false") {
        conditions.push(eq(appUsers.is_anonymous, false));
      }

      if (search) {
        conditions.push(ilike(appUsers.user_id, `%${search}%`));
      }

      if (cursor) {
        conditions.push(lt(appUsers.last_seen_at, new Date(cursor)));
      }

      const rows = await app.db
        .select()
        .from(appUsers)
        .where(and(...conditions))
        .orderBy(desc(appUsers.last_seen_at))
        .limit(limit + 1);

      const has_more = rows.length > limit;
      const page = has_more ? rows.slice(0, limit) : rows;

      return {
        users: page.map(serializeAppUser),
        cursor: has_more
          ? page[page.length - 1].last_seen_at.toISOString()
          : null,
        has_more,
      };
    }
  );

  // Team-scoped user listing (cross-app)
  app.get<{ Querystring: TeamAppUsersQueryParams }>(
    "/app-users",
    { preHandler: requirePermission("apps:read") },
    async (request) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);

      const {
        team_id,
        project_id,
        app_id,
        search,
        is_anonymous,
        since,
        until,
        cursor,
        limit: rawLimit,
      } = request.query;

      const limit = normalizeLimit(rawLimit);

      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { users: [], cursor: null, has_more: false };
      }

      const conditions = [];

      if (app_id) {
        const [appRow] = await app.db
          .select({ id: apps.id })
          .from(apps)
          .where(
            and(eq(apps.id, app_id), inArray(apps.team_id, teamIds), isNull(apps.deleted_at))
          )
          .limit(1);
        if (!appRow) {
          return { users: [], cursor: null, has_more: false };
        }
        conditions.push(eq(appUsers.app_id, app_id));
      } else if (project_id) {
        const projectApps = await app.db
          .select({ id: apps.id })
          .from(apps)
          .where(
            and(eq(apps.project_id, project_id), inArray(apps.team_id, teamIds), isNull(apps.deleted_at))
          );
        const projectAppIds = projectApps.map((a) => a.id);
        if (projectAppIds.length === 0) {
          return { users: [], cursor: null, has_more: false };
        }
        conditions.push(inArray(appUsers.app_id, projectAppIds));
      } else {
        const teamApps = await app.db
          .select({ id: apps.id })
          .from(apps)
          .where(and(inArray(apps.team_id, teamIds), isNull(apps.deleted_at)));
        const teamAppIds = teamApps.map((a) => a.id);
        if (teamAppIds.length === 0) {
          return { users: [], cursor: null, has_more: false };
        }
        conditions.push(inArray(appUsers.app_id, teamAppIds));
      }

      if (is_anonymous === "true") {
        conditions.push(eq(appUsers.is_anonymous, true));
      } else if (is_anonymous === "false") {
        conditions.push(eq(appUsers.is_anonymous, false));
      }

      if (search) {
        conditions.push(ilike(appUsers.user_id, `%${search}%`));
      }

      if (since) {
        conditions.push(gte(appUsers.last_seen_at, new Date(since)));
      }
      if (until) {
        conditions.push(lte(appUsers.last_seen_at, new Date(until)));
      }

      if (cursor) {
        conditions.push(lt(appUsers.last_seen_at, new Date(cursor)));
      }

      const rows = await app.db
        .select()
        .from(appUsers)
        .where(and(...conditions))
        .orderBy(desc(appUsers.last_seen_at))
        .limit(limit + 1);

      const has_more = rows.length > limit;
      const page = has_more ? rows.slice(0, limit) : rows;

      return {
        users: page.map(serializeAppUser),
        cursor: has_more
          ? page[page.length - 1].last_seen_at.toISOString()
          : null,
        has_more,
      };
    }
  );
}
