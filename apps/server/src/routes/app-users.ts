import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, lt, desc, inArray, isNull, ilike } from "drizzle-orm";
import { apps, appUsers, appUserApps } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { parseTimeParam } from "@owlmetry/shared";
import type { AppUsersQueryParams, TeamAppUsersQueryParams } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { serializeAppUser } from "../utils/serialize.js";
import { normalizeLimit } from "../utils/pagination.js";

/** Fetch junction app info for a set of app_user IDs and build a lookup map. */
async function loadAppInfoForUsers(
  db: Db,
  userIds: string[],
): Promise<Map<string, Array<{ app_id: string; app_name: string; first_seen_at: Date; last_seen_at: Date }>>> {
  if (userIds.length === 0) return new Map();

  const junctions = await db
    .select({
      app_user_id: appUserApps.app_user_id,
      app_id: appUserApps.app_id,
      first_seen_at: appUserApps.first_seen_at,
      last_seen_at: appUserApps.last_seen_at,
      app_name: apps.name,
    })
    .from(appUserApps)
    .innerJoin(apps, eq(apps.id, appUserApps.app_id))
    .where(inArray(appUserApps.app_user_id, userIds));

  const map = new Map<string, Array<{ app_id: string; app_name: string; first_seen_at: Date; last_seen_at: Date }>>();
  for (const j of junctions) {
    const list = map.get(j.app_user_id) ?? [];
    list.push({ app_id: j.app_id, app_name: j.app_name, first_seen_at: j.first_seen_at, last_seen_at: j.last_seen_at });
    map.set(j.app_user_id, list);
  }
  return map;
}

export async function appUsersRoutes(app: FastifyInstance) {
  // Per-app user listing (users who have been seen from a specific app)
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

      // Query users via junction table
      const conditions = [];

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
        .select({
          id: appUsers.id,
          project_id: appUsers.project_id,
          user_id: appUsers.user_id,
          is_anonymous: appUsers.is_anonymous,
          claimed_from: appUsers.claimed_from,
          properties: appUsers.properties,
          first_seen_at: appUsers.first_seen_at,
          last_seen_at: appUsers.last_seen_at,
        })
        .from(appUsers)
        .innerJoin(appUserApps, eq(appUserApps.app_user_id, appUsers.id))
        .where(and(eq(appUserApps.app_id, id), ...conditions))
        .orderBy(desc(appUsers.last_seen_at))
        .limit(limit + 1);

      const has_more = rows.length > limit;
      const page = has_more ? rows.slice(0, limit) : rows;

      // Load app info for returned users
      const appInfoMap = await loadAppInfoForUsers(app.db, page.map((u) => u.id));

      return {
        users: page.map((u) =>
          serializeAppUser({ ...u, apps: appInfoMap.get(u.id) ?? [] })
        ),
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
        // Filter by specific app — need to join through junction table
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

        // Get user IDs that have junction entries for this app
        const junctionUserIds = await app.db
          .select({ app_user_id: appUserApps.app_user_id })
          .from(appUserApps)
          .where(eq(appUserApps.app_id, app_id));

        if (junctionUserIds.length === 0) {
          return { users: [], cursor: null, has_more: false };
        }
        conditions.push(inArray(appUsers.id, junctionUserIds.map((j) => j.app_user_id)));
      } else if (project_id) {
        // Filter directly by project_id on app_users
        conditions.push(eq(appUsers.project_id, project_id));
      } else {
        // Team scope: get all project IDs for team
        const teamProjects = await app.db
          .select({ id: apps.project_id })
          .from(apps)
          .where(and(inArray(apps.team_id, teamIds), isNull(apps.deleted_at)));
        const projectIds = [...new Set(teamProjects.map((p) => p.id))];
        if (projectIds.length === 0) {
          return { users: [], cursor: null, has_more: false };
        }
        conditions.push(inArray(appUsers.project_id, projectIds));
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
        conditions.push(gte(appUsers.last_seen_at, parseTimeParam(since)));
      }
      if (until) {
        conditions.push(lte(appUsers.last_seen_at, parseTimeParam(until)));
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

      // Load app info for returned users
      const appInfoMap = await loadAppInfoForUsers(app.db, page.map((u) => u.id));

      return {
        users: page.map((u) =>
          serializeAppUser({ ...u, apps: appInfoMap.get(u.id) ?? [] })
        ),
        cursor: has_more
          ? page[page.length - 1].last_seen_at.toISOString()
          : null,
        has_more,
      };
    }
  );
}
