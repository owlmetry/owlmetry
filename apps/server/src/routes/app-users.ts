import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, lt, desc, inArray, isNull, ilike, or, sql, type SQL } from "drizzle-orm";
import { apps, projects, appUsers, appUserApps } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import {
  parseTimeParam,
  parseBillingTiers,
  isBillingFilterActive,
  APP_PLATFORMS,
  baseLanguage,
  type BillingTier,
} from "@owlmetry/shared";
import type {
  AppUsersQueryParams,
  TeamAppUsersQueryParams,
  UserLocalesResponse,
  LocaleDemandRow,
} from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { serializeAppUser } from "../utils/serialize.js";
import { normalizeLimit } from "../utils/pagination.js";
import { paidTierPredicate } from "../utils/billing-sql.js";

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
    exprs.push(paidTierPredicate(sql`${appUsers.properties}`));
  }
  if (tiers.has("free")) {
    exprs.push(
      sql`(${appUsers.properties}->>'rc_subscriber') IS DISTINCT FROM 'true' AND (${appUsers.properties}->>'rc_period_type') IS DISTINCT FROM 'trial'`,
    );
  }
  return or(...exprs);
}

// User-facing surfaces show one app pill + "+N more" — order by platform so client
// platforms (apple/android/web) surface ahead of backend.
const platformRank = (p: string): number => {
  const i = APP_PLATFORMS.indexOf(p as (typeof APP_PLATFORMS)[number]);
  return i === -1 ? APP_PLATFORMS.length : i;
};

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
      platform: apps.platform,
    })
    .from(appUserApps)
    .innerJoin(apps, eq(apps.id, appUserApps.app_id))
    .where(inArray(appUserApps.app_user_id, userIds));

  type Entry = { app_id: string; app_name: string; first_seen_at: Date; last_seen_at: Date; platform: string };
  const buckets = new Map<string, Entry[]>();
  for (const j of junctions) {
    const list = buckets.get(j.app_user_id) ?? [];
    list.push({
      app_id: j.app_id,
      app_name: j.app_name,
      first_seen_at: j.first_seen_at,
      last_seen_at: j.last_seen_at,
      platform: j.platform,
    });
    buckets.set(j.app_user_id, list);
  }

  const map = new Map<string, Array<{ app_id: string; app_name: string; first_seen_at: Date; last_seen_at: Date }>>();
  for (const [userId, list] of buckets) {
    list.sort((a, b) => {
      const r = platformRank(a.platform) - platformRank(b.platform);
      if (r !== 0) return r;
      return b.last_seen_at.getTime() - a.last_seen_at.getTime();
    });
    map.set(
      userId,
      list.map(({ platform: _platform, ...rest }) => rest),
    );
  }
  return map;
}

/**
 * Resolve the languages "in scope" ships, used to compute the localization gap.
 * - app_id given      → that app's supported_languages.
 * - else project_id    → union across that project's (non-deleted) apps.
 * - else (team scope)  → null; "shipped" isn't meaningful across many apps, so
 *                        the page renders demand without gap badges.
 * Returns null when nothing is configured.
 */
async function resolveSupportedLanguages(
  db: Db,
  opts: { appId?: string; projectId?: string },
): Promise<string[] | null> {
  let rows: Array<{ supported_languages: string[] | null }> = [];
  if (opts.appId) {
    rows = await db
      .select({ supported_languages: apps.supported_languages })
      .from(apps)
      .where(eq(apps.id, opts.appId))
      .limit(1);
  } else if (opts.projectId) {
    rows = await db
      .select({ supported_languages: apps.supported_languages })
      .from(apps)
      .where(and(eq(apps.project_id, opts.projectId), isNull(apps.deleted_at)));
  } else {
    return null;
  }
  const union = new Set<string>();
  for (const r of rows) {
    for (const lang of r.supported_languages ?? []) union.add(lang);
  }
  return union.size > 0 ? [...union].sort() : null;
}

/**
 * Aggregate app_users in scope by wanted language (preferred) and by country.
 * `projectIds` bounds the scope (one project, or every project for a team);
 * `appId` further narrows via the junction. `supportedLanguages` drives the
 * per-row `shipped` flag (null ⇒ no flag) — accepts a promise so the caller's
 * supported-languages lookup overlaps these aggregations instead of blocking
 * them (it's only consumed after the queries return).
 */
async function computeLocaleDemand(
  db: Db,
  opts: {
    projectIds: string[];
    appId?: string;
    supportedLanguages: (string[] | null) | Promise<string[] | null>;
  },
): Promise<UserLocalesResponse> {
  const { projectIds, appId } = opts;
  const scope = appId
    ? and(inArray(appUsers.project_id, projectIds), eq(appUserApps.app_id, appId))
    : inArray(appUsers.project_id, projectIds);

  // A `GROUP BY <column>` count over the in-scope users. When an app filter is
  // active we join through the junction; otherwise project_id alone bounds it.
  const groupedCount = (
    column:
      | typeof appUsers.last_preferred_language
      | typeof appUsers.last_country_code,
  ) => {
    const select = { value: column, count: sql<number>`count(*)::int` };
    const q = appId
      ? db
          .select(select)
          .from(appUsers)
          .innerJoin(appUserApps, eq(appUserApps.app_user_id, appUsers.id))
      : db.select(select).from(appUsers);
    return q
      .where(and(scope, sql`${column} IS NOT NULL`))
      .groupBy(column)
      .orderBy(sql`count(*) DESC`);
  };

  const totalsSelect = {
    total: sql<number>`count(*)::int`,
    with_preferred: sql<number>`count(*) FILTER (WHERE ${appUsers.last_preferred_language} IS NOT NULL)::int`,
  };
  const totalsQuery = (
    appId
      ? db
          .select(totalsSelect)
          .from(appUsers)
          .innerJoin(appUserApps, eq(appUserApps.app_user_id, appUsers.id))
      : db.select(totalsSelect).from(appUsers)
  ).where(scope);

  // Three aggregations over the same scope, run together — and resolve the
  // (independent) supported-languages lookup in the same round-trip window.
  const [localeRows, countryRows, totalsRows, supportedLanguages] = await Promise.all([
    groupedCount(appUsers.last_preferred_language),
    groupedCount(appUsers.last_country_code),
    totalsQuery,
    Promise.resolve(opts.supportedLanguages),
  ]);

  const supportedBase =
    supportedLanguages !== null
      ? new Set(supportedLanguages.map((l) => baseLanguage(l)))
      : null;

  const by_locale: LocaleDemandRow[] = localeRows
    .filter((r): r is { value: string; count: number } => r.value !== null)
    .map((r) => {
      const base_language = baseLanguage(r.value);
      return {
        locale: r.value,
        base_language,
        user_count: r.count,
        shipped: supportedBase ? supportedBase.has(base_language) : null,
      };
    });

  const by_country = countryRows
    .filter((r): r is { value: string; count: number } => r.value !== null)
    .map((r) => ({ country_code: r.value, user_count: r.count }));

  const totals = totalsRows[0] ?? { total: 0, with_preferred: 0 };

  return {
    by_locale,
    by_country,
    supported_languages: supportedLanguages,
    users_with_preferred_language: totals.with_preferred,
    total_users: totals.total,
  };
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
          last_sdk_name: appUsers.last_sdk_name,
          last_sdk_version: appUsers.last_sdk_version,
          last_locale: appUsers.last_locale,
          last_preferred_language: appUsers.last_preferred_language,
          total_revenue_usd_cents: appUsers.total_revenue_usd_cents,
          revenue_synced_at: appUsers.revenue_synced_at,
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
              last_app_version: appUsers.last_app_version,
              last_sdk_name: appUsers.last_sdk_name,
              last_sdk_version: appUsers.last_sdk_version,
              total_revenue_usd_cents: appUsers.total_revenue_usd_cents,
              revenue_synced_at: appUsers.revenue_synced_at,
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

  // Locale demand for a single project (optionally narrowed to one app).
  app.get<{ Params: { projectId: string }; Querystring: { app_id?: string } }>(
    "/projects/:projectId/users/locales",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { projectId } = request.params;
      const { app_id } = request.query;
      const teamIds = getAuthTeamIds(auth);

      const [proj] = await app.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, projectId), inArray(projects.team_id, teamIds), isNull(projects.deleted_at)),
        )
        .limit(1);
      if (!proj) return reply.code(404).send({ error: "Project not found" });

      if (app_id) {
        const [appRow] = await app.db
          .select({ id: apps.id })
          .from(apps)
          .where(and(eq(apps.id, app_id), eq(apps.project_id, projectId), isNull(apps.deleted_at)))
          .limit(1);
        if (!appRow) return reply.code(404).send({ error: "App not found" });
      }

      return computeLocaleDemand(app.db, {
        projectIds: [projectId],
        appId: app_id,
        // Passed un-awaited so the lookup overlaps the demand aggregations.
        supportedLanguages: resolveSupportedLanguages(app.db, { appId: app_id, projectId }),
      });
    },
  );

  // Locale demand across a team (optionally narrowed to a project / app).
  // team_id ⊥ project_id ⊥ app_id; short-circuits to empty for inaccessible scope.
  app.get<{ Querystring: { team_id?: string; project_id?: string; app_id?: string } }>(
    "/users/locales",
    { preHandler: requirePermission("apps:read") },
    async (request) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      const { team_id, project_id, app_id } = request.query;

      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      const empty: UserLocalesResponse = {
        by_locale: [],
        by_country: [],
        supported_languages: null,
        users_with_preferred_language: 0,
        total_users: 0,
      };
      if (teamIds.length === 0) return empty;

      let projectIds: string[];
      if (app_id) {
        const [appRow] = await app.db
          .select({ id: apps.id, project_id: apps.project_id })
          .from(apps)
          .where(and(eq(apps.id, app_id), inArray(apps.team_id, teamIds), isNull(apps.deleted_at)))
          .limit(1);
        if (!appRow) return empty;
        projectIds = [appRow.project_id];
      } else if (project_id) {
        const [proj] = await app.db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(eq(projects.id, project_id), inArray(projects.team_id, teamIds), isNull(projects.deleted_at)),
          )
          .limit(1);
        if (!proj) return empty;
        projectIds = [project_id];
      } else {
        const teamProjects = await app.db
          .select({ id: projects.id })
          .from(projects)
          .where(and(inArray(projects.team_id, teamIds), isNull(projects.deleted_at)));
        if (teamProjects.length === 0) return empty;
        projectIds = teamProjects.map((p) => p.id);
      }

      return computeLocaleDemand(app.db, {
        projectIds,
        appId: app_id,
        // Passed un-awaited so the lookup overlaps the demand aggregations.
        supportedLanguages: resolveSupportedLanguages(app.db, {
          appId: app_id,
          projectId: app_id ? undefined : project_id,
        }),
      });
    },
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
