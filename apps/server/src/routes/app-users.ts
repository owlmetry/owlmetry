import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, lt, desc, inArray, isNull, ilike, or, sql, type SQL } from "drizzle-orm";
import { apps, projects, appUsers, appUserApps } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import {
  parseTimeParam,
  parseBillingTiers,
  isBillingFilterActive,
  type BillingTier,
} from "@owlmetry/shared";
import type { AppUsersQueryParams, TeamAppUsersQueryParams } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { serializeAppUser } from "../utils/serialize.js";
import { normalizeLimit } from "../utils/pagination.js";

/**
 * Build a SQL predicate that matches users in any of the requested billing tiers.
 * Tiers are derived from the JSONB `properties` column (rc_period_type, rc_subscriber),
 * matching the dashboard's badge logic. `IS DISTINCT FROM` so NULL values behave as "not equal".
 *
 * Note: `rc_subscriber` is only `"true"` for users on a renewing subscription.
 * A cancelled trial has `rc_subscriber="false"` + `rc_period_type="trial"`, so it
 * correctly matches the `trial` tier and NOT the `paid` tier.
 */
function buildBillingStatusCondition(tiers: Set<BillingTier>): SQL | undefined {
  const exprs: SQL[] = [];
  if (tiers.has("trial")) {
    exprs.push(sql`${appUsers.properties}->>'rc_period_type' = 'trial'`);
  }
  if (tiers.has("paid")) {
    exprs.push(
      sql`${appUsers.properties}->>'rc_subscriber' = 'true' AND (${appUsers.properties}->>'rc_period_type') IS DISTINCT FROM 'trial'`,
    );
  }
  if (tiers.has("free")) {
    exprs.push(
      sql`(${appUsers.properties}->>'rc_subscriber') IS DISTINCT FROM 'true' AND (${appUsers.properties}->>'rc_period_type') IS DISTINCT FROM 'trial'`,
    );
  }
  return or(...exprs);
}

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
      const { search, is_anonymous, billing_status, sort, cursor, limit: rawLimit } = request.query;

      const limit = normalizeLimit(rawLimit);
      const sortColumn = sort === "first_seen" ? appUsers.first_seen_at : appUsers.last_seen_at;

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

      const billingTiers = parseBillingTiers(billing_status);
      if (isBillingFilterActive(billingTiers)) {
        const billingCondition = buildBillingStatusCondition(billingTiers);
        if (billingCondition) conditions.push(billingCondition);
      }

      if (cursor) {
        conditions.push(lt(sortColumn, new Date(cursor)));
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
          last_country_code: appUsers.last_country_code,
          last_app_version: appUsers.last_app_version,
        })
        .from(appUsers)
        .innerJoin(appUserApps, eq(appUserApps.app_user_id, appUsers.id))
        .where(and(eq(appUserApps.app_id, id), ...conditions))
        .orderBy(desc(sortColumn))
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
          ? (sort === "first_seen"
              ? page[page.length - 1].first_seen_at.toISOString()
              : page[page.length - 1].last_seen_at.toISOString())
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
        billing_status,
        since,
        until,
        sort,
        cursor,
        limit: rawLimit,
      } = request.query;

      const limit = normalizeLimit(rawLimit);
      const sortColumn = sort === "first_seen" ? appUsers.first_seen_at : appUsers.last_seen_at;

      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { users: [], cursor: null, has_more: false };
      }

      const conditions = [];

      // Track whether we need to join through app_user_apps for app filtering
      let filterByAppId: string | null = null;

      if (app_id) {
        // Verify app belongs to caller's team
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
        filterByAppId = app_id;
      } else if (project_id) {
        // Verify project belongs to caller's team
        const [proj] = await app.db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(eq(projects.id, project_id), inArray(projects.team_id, teamIds), isNull(projects.deleted_at))
          )
          .limit(1);
        if (!proj) {
          return { users: [], cursor: null, has_more: false };
        }
        conditions.push(eq(appUsers.project_id, project_id));
      } else {
        // Team scope: get all project IDs directly from projects table
        const teamProjects = await app.db
          .select({ id: projects.id })
          .from(projects)
          .where(and(inArray(projects.team_id, teamIds), isNull(projects.deleted_at)));
        if (teamProjects.length === 0) {
          return { users: [], cursor: null, has_more: false };
        }
        conditions.push(inArray(appUsers.project_id, teamProjects.map((p) => p.id)));
      }

      if (is_anonymous === "true") {
        conditions.push(eq(appUsers.is_anonymous, true));
      } else if (is_anonymous === "false") {
        conditions.push(eq(appUsers.is_anonymous, false));
      }

      if (search) {
        conditions.push(ilike(appUsers.user_id, `%${search}%`));
      }

      const billingTiers = parseBillingTiers(billing_status);
      if (isBillingFilterActive(billingTiers)) {
        const billingCondition = buildBillingStatusCondition(billingTiers);
        if (billingCondition) conditions.push(billingCondition);
      }

      if (since) {
        conditions.push(gte(appUsers.last_seen_at, parseTimeParam(since)));
      }
      if (until) {
        conditions.push(lte(appUsers.last_seen_at, parseTimeParam(until)));
      }

      if (cursor) {
        conditions.push(lt(sortColumn, new Date(cursor)));
      }

      // When filtering by app_id, JOIN through junction table instead of unbounded IN
      const query = filterByAppId
        ? app.db
            .select({
              id: appUsers.id,
              project_id: appUsers.project_id,
              user_id: appUsers.user_id,
              is_anonymous: appUsers.is_anonymous,
              claimed_from: appUsers.claimed_from,
              properties: appUsers.properties,
              first_seen_at: appUsers.first_seen_at,
              last_seen_at: appUsers.last_seen_at,
              last_country_code: appUsers.last_country_code,
            })
            .from(appUsers)
            .innerJoin(appUserApps, eq(appUserApps.app_user_id, appUsers.id))
            .where(and(eq(appUserApps.app_id, filterByAppId), ...conditions))
        : app.db
            .select()
            .from(appUsers)
            .where(and(...conditions));

      const rows = await query
        .orderBy(desc(sortColumn))
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
          ? (sort === "first_seen"
              ? page[page.length - 1].first_seen_at.toISOString()
              : page[page.length - 1].last_seen_at.toISOString())
          : null,
        has_more,
      };
    }
  );

  // Single user by internal id
  app.get<{ Params: { id: string } }>(
    "/app-users/:id",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;

      const [row] = await app.db
        .select()
        .from(appUsers)
        .where(eq(appUsers.id, id))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "User not found" });
      }

      const [project] = await app.db
        .select({ team_id: projects.team_id })
        .from(projects)
        .where(and(eq(projects.id, row.project_id), isNull(projects.deleted_at)))
        .limit(1);

      const allTeamIds = getAuthTeamIds(auth);
      if (!project || !allTeamIds.includes(project.team_id)) {
        return reply.code(404).send({ error: "User not found" });
      }

      const appInfoMap = await loadAppInfoForUsers(app.db, [row.id]);
      return serializeAppUser({ ...row, apps: appInfoMap.get(row.id) ?? [] });
    }
  );
}
