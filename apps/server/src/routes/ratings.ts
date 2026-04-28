import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { appStoreRatings, apps, projects } from "@owlmetry/db";
import {
  REVIEW_STORES,
  type ReviewStore,
  type PerCountryRating,
  type AppRatingSummary,
  type AppRatingsResponse,
  type RatingsByCountryRow,
  type RatingsByCountryResponse,
} from "@owlmetry/shared";
import { requirePermission, assertTeamRole, getAuthTeamIds } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { formatManualTriggeredBy } from "../utils/integrations.js";

const APP_STORE = "app_store" as const;

function toFloat(v: string | number | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : Number.parseFloat(v);
}

function parseStore(raw: string | undefined): ReviewStore {
  return raw && (REVIEW_STORES as readonly string[]).includes(raw) ? (raw as ReviewStore) : APP_STORE;
}

// Aggregate ratings by country across the projects matching `projectFilter`
// (and optionally a single app), using the latest snapshot per (app, country)
// and including a delta vs the second-latest snapshot. Window function pulls
// the top 2 snapshots per (app, country); LEFT JOIN exposes both as one row.
//
// rating_count_delta semantics:
//   - Sum (latest.rating_count − previous.rating_count) per country, across
//     apps that have a previous snapshot. Apps with no previous snapshot
//     contribute 0 (we don't know if their ratings actually grew, just that
//     we have data now).
//   - Result is NULL when no app/country pair has a previous snapshot —
//     keeps the UI silent rather than rendering "+0".
function aggregateByCountryWithDeltas(opts: {
  projectFilter: ReturnType<typeof sql>;
  appId?: string;
  store: ReviewStore;
}) {
  return sql`
    WITH ranked AS (
      SELECT app_id, country_code, average_rating, rating_count, snapshot_date,
             ROW_NUMBER() OVER (PARTITION BY app_id, country_code ORDER BY snapshot_date DESC) AS rn
      FROM ${appStoreRatings}
      WHERE ${opts.projectFilter}
        AND store = ${opts.store}
        ${opts.appId ? sql`AND app_id = ${opts.appId}` : sql``}
    ),
    latest AS (
      SELECT l.app_id, l.country_code, l.average_rating, l.rating_count,
             p.rating_count AS previous_rating_count
      FROM ranked l
      LEFT JOIN ranked p
        ON p.app_id = l.app_id AND p.country_code = l.country_code AND p.rn = 2
      WHERE l.rn = 1
    )
    SELECT
      country_code,
      (SUM(average_rating * rating_count) / NULLIF(SUM(rating_count), 0))::float AS average_rating,
      SUM(rating_count)::int AS rating_count,
      CASE WHEN COUNT(previous_rating_count) > 0
           THEN SUM(CASE WHEN previous_rating_count IS NOT NULL
                         THEN rating_count - previous_rating_count
                         ELSE 0 END)::int
           ELSE NULL END AS rating_count_delta
    FROM latest
    WHERE average_rating IS NOT NULL AND rating_count > 0
    GROUP BY country_code
    ORDER BY rating_count DESC, country_code ASC
  `;
}

type ByCountryDbRow = {
  country_code: string;
  average_rating: number;
  rating_count: number;
  rating_count_delta: number | null;
} & Record<string, unknown>;

function serializeByCountry(rows: ByCountryDbRow[]): RatingsByCountryRow[] {
  return rows.map((r) => ({
    country_code: r.country_code,
    average_rating: Math.round(Number(r.average_rating) * 100) / 100,
    rating_count: Number(r.rating_count),
    rating_count_delta: r.rating_count_delta == null ? null : Number(r.rating_count_delta),
  }));
}

export async function ratingsRoutes(app: FastifyInstance) {
  // Per-app per-country breakdown + worldwide summary. Tombstone rows
  // (average_rating IS NULL) are filtered out — the UI only cares about
  // active storefronts.
  app.get<{ Params: { projectId: string; appId: string }; Querystring: { store?: string } }>(
    "/apps/:appId/ratings",
    { preHandler: requirePermission("reviews:read") },
    async (request, reply) => {
      const { projectId, appId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const store = parseStore(request.query.store);

      // ROW_NUMBER() pivots the latest two snapshots per country into one row
      // so we can compute (latest − previous) without a second round-trip.
      // previous_rating_count is null when this country has no prior snapshot.
      type PerCountryDbRow = {
        country_code: string;
        average_rating: string | null;
        rating_count: number;
        previous_rating_count: number | null;
        current_version_average_rating: string | null;
        current_version_rating_count: number | null;
        app_version: string | null;
        snapshot_date: string;
      };
      const [appRow, rows] = await Promise.all([
        app.db
          .select({
            worldwide_average_rating: apps.worldwide_average_rating,
            worldwide_rating_count: apps.worldwide_rating_count,
            worldwide_current_version_rating: apps.worldwide_current_version_rating,
            worldwide_current_version_rating_count: apps.worldwide_current_version_rating_count,
            ratings_synced_at: apps.ratings_synced_at,
          })
          .from(apps)
          .where(and(eq(apps.id, appId), eq(apps.project_id, projectId), isNull(apps.deleted_at)))
          .limit(1),
        app.db.execute<PerCountryDbRow>(sql`
          WITH ranked AS (
            SELECT country_code, average_rating, rating_count,
                   current_version_average_rating, current_version_rating_count,
                   app_version, snapshot_date,
                   ROW_NUMBER() OVER (PARTITION BY country_code ORDER BY snapshot_date DESC) AS rn
            FROM ${appStoreRatings}
            WHERE app_id = ${appId} AND store = ${store}
          )
          SELECT l.country_code, l.average_rating, l.rating_count,
                 l.current_version_average_rating, l.current_version_rating_count,
                 l.app_version, l.snapshot_date,
                 p.rating_count AS previous_rating_count
          FROM ranked l
          LEFT JOIN ranked p ON p.country_code = l.country_code AND p.rn = 2
          WHERE l.rn = 1
          ORDER BY l.country_code
        `),
      ]);
      if (!appRow[0]) return reply.code(404).send({ error: "App not found" });
      const summaryRow = appRow[0];

      const ratings: PerCountryRating[] = rows
        .filter((r) => r.average_rating !== null && r.rating_count > 0)
        .map((r) => ({
          country_code: r.country_code,
          average_rating: toFloat(r.average_rating),
          rating_count: Number(r.rating_count),
          rating_count_delta:
            r.previous_rating_count == null
              ? null
              : Number(r.rating_count) - Number(r.previous_rating_count),
          current_version_average_rating: toFloat(r.current_version_average_rating),
          current_version_rating_count: r.current_version_rating_count,
          app_version: r.app_version,
          snapshot_date: r.snapshot_date,
        }))
        .sort((a, b) => b.rating_count - a.rating_count);

      // Worldwide delta sums (latest − previous) over every country with a
      // prior snapshot — including tombstones (latest=0, previous=N → −N
      // captures real drops) and excluding brand-new countries (previous=null
      // → don't conflate "discovered" with "grew"). Null when no country has
      // any prior data.
      let worldwideDelta: number | null = null;
      for (const r of rows) {
        if (r.previous_rating_count == null) continue;
        const delta = Number(r.rating_count) - Number(r.previous_rating_count);
        worldwideDelta = (worldwideDelta ?? 0) + delta;
      }

      const summary: AppRatingSummary = {
        worldwide_average: toFloat(summaryRow.worldwide_average_rating),
        worldwide_count: summaryRow.worldwide_rating_count ?? 0,
        worldwide_rating_count_delta: worldwideDelta,
        current_version_average: toFloat(summaryRow.worldwide_current_version_rating),
        current_version_count: summaryRow.worldwide_current_version_rating_count,
        synced_at: summaryRow.ratings_synced_at?.toISOString() ?? null,
      };

      const response: AppRatingsResponse = { ratings, summary };
      return response;
    },
  );

  // Project-wide ratings rolled up by country. Latest snapshot per (app,
  // country), weighted by rating_count when averaging.
  app.get<{ Params: { projectId: string }; Querystring: { app_id?: string; store?: string } }>(
    "/ratings/by-country",
    { preHandler: requirePermission("reviews:read") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const store = parseStore(request.query.store);
      const appId = request.query.app_id;

      const rows = await app.db.execute<ByCountryDbRow>(
        aggregateByCountryWithDeltas({
          projectFilter: sql`project_id = ${projectId}`,
          appId,
          store,
        }),
      );

      const response: RatingsByCountryResponse = {
        countries: serializeByCountry(rows),
      };
      return response;
    },
  );

  // Manual sync trigger — admin only. Mirrors POST /integrations/app-store-connect/sync.
  app.post<{ Params: { projectId: string } }>(
    "/ratings/sync",
    { preHandler: requirePermission("reviews:write") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const eligibleApps = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(
          and(
            eq(apps.project_id, projectId),
            eq(apps.platform, "apple"),
            isNull(apps.deleted_at),
          ),
        );
      if (eligibleApps.length === 0) {
        return { syncing: false, total: 0 };
      }

      const run = await app.jobRunner.trigger("app_store_ratings_sync", {
        triggeredBy: formatManualTriggeredBy(request.auth),
        teamId: project.team_id,
        projectId,
        params: { project_id: projectId },
      });

      return { syncing: true, total: eligibleApps.length, job_run_id: run.id };
    },
  );
}

// Team-scoped sibling — used by dashboard "All projects" views.
export async function teamRatingsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { team_id?: string; project_id?: string; app_id?: string; store?: string };
  }>(
    "/ratings/by-country",
    { preHandler: requirePermission("reviews:read") },
    async (request) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      const { team_id, project_id, app_id, store } = request.query;

      const teamIds = team_id ? (allTeamIds.includes(team_id) ? [team_id] : []) : allTeamIds;
      if (teamIds.length === 0) return { countries: [] } satisfies RatingsByCountryResponse;

      const projectConditions = [inArray(projects.team_id, teamIds), isNull(projects.deleted_at)];
      if (project_id) projectConditions.push(eq(projects.id, project_id));
      const accessibleProjects = await app.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(...projectConditions));
      if (accessibleProjects.length === 0) return { countries: [] } satisfies RatingsByCountryResponse;

      const projectIds = accessibleProjects.map((p) => p.id);
      const projectIdList = sql.join(
        projectIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const rows = await app.db.execute<ByCountryDbRow>(
        aggregateByCountryWithDeltas({
          projectFilter: sql`project_id IN (${projectIdList})`,
          appId: app_id,
          store: parseStore(store),
        }),
      );
      return { countries: serializeByCountry(rows) } satisfies RatingsByCountryResponse;
    },
  );
}
