import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, isNotNull, sql, desc, asc } from "drizzle-orm";
import { appStoreReviews, apps, projects } from "@owlmetry/db";
import { REVIEW_STORES, type ReviewStore, type ReviewsQueryParams } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { resolveProject } from "../utils/project.js";
import {
  normalizeLimit,
  encodeKeysetCursor,
  decodeKeysetCursor,
} from "../utils/pagination.js";

function serializeReview(
  row: typeof appStoreReviews.$inferSelect,
  appName: string,
) {
  return {
    id: row.id,
    app_id: row.app_id,
    app_name: appName,
    project_id: row.project_id,
    store: row.store as ReviewStore,
    external_id: row.external_id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    reviewer_name: row.reviewer_name,
    country_code: row.country_code,
    app_version: row.app_version,
    language_code: row.language_code,
    developer_response: row.developer_response,
    developer_response_at: row.developer_response_at?.toISOString() ?? null,
    created_at_in_store: row.created_at_in_store.toISOString(),
    ingested_at: row.ingested_at.toISOString(),
  };
}

async function runReviewsQuery(
  app: FastifyInstance,
  conditions: ReturnType<typeof eq>[],
  limit: number,
) {
  const rows = await app.db
    .select()
    .from(appStoreReviews)
    .where(and(...conditions))
    .orderBy(desc(appStoreReviews.created_at_in_store), desc(appStoreReviews.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const appIds = [...new Set(page.map((r) => r.app_id))];
  const appRows = appIds.length
    ? await app.db.select({ id: apps.id, name: apps.name }).from(apps).where(inArray(apps.id, appIds))
    : [];
  const appNameMap = new Map(appRows.map((a) => [a.id, a.name]));

  const lastItem = page[page.length - 1];
  return {
    reviews: page.map((r) => serializeReview(r, appNameMap.get(r.app_id) ?? "")),
    cursor: hasMore && lastItem ? encodeKeysetCursor(lastItem.created_at_in_store, lastItem.id) : null,
    has_more: hasMore,
  };
}

function cursorCondition(cursor: string | undefined) {
  if (!cursor) return null;
  const decoded = decodeKeysetCursor(cursor);
  if (!decoded) return null;
  return sql`(${appStoreReviews.created_at_in_store} < ${decoded.timestamp}::timestamptz OR (${appStoreReviews.created_at_in_store} = ${decoded.timestamp}::timestamptz AND ${appStoreReviews.id} < ${decoded.id}))`;
}

function buildFilterConditions(query: ReviewsQueryParams) {
  const conditions = [];
  if (query.app_id) conditions.push(eq(appStoreReviews.app_id, query.app_id));
  if (query.store && (REVIEW_STORES as readonly string[]).includes(query.store)) {
    conditions.push(eq(appStoreReviews.store, query.store));
  }
  if (query.rating !== undefined) {
    conditions.push(eq(appStoreReviews.rating, Number(query.rating)));
  }
  if (query.rating_lte !== undefined) {
    conditions.push(sql`${appStoreReviews.rating} <= ${Number(query.rating_lte)}`);
  }
  if (query.rating_gte !== undefined) {
    conditions.push(sql`${appStoreReviews.rating} >= ${Number(query.rating_gte)}`);
  }
  if (query.country_code) {
    conditions.push(eq(appStoreReviews.country_code, query.country_code.toLowerCase()));
  }
  if (query.has_developer_response !== undefined) {
    const flag =
      typeof query.has_developer_response === "boolean"
        ? query.has_developer_response
        : query.has_developer_response === "true";
    conditions.push(flag ? isNotNull(appStoreReviews.developer_response) : isNull(appStoreReviews.developer_response));
  }
  if (query.search && query.search.trim()) {
    const term = `%${query.search.trim()}%`;
    conditions.push(sql`(${appStoreReviews.title} ILIKE ${term} OR ${appStoreReviews.body} ILIKE ${term})`);
  }
  return conditions;
}

export async function reviewsRoutes(app: FastifyInstance) {
  // List reviews scoped to a single project.
  app.get<{ Params: { projectId: string }; Querystring: ReviewsQueryParams & { cursor?: string; limit?: string } }>(
    "/reviews",
    { preHandler: requirePermission("reviews:read") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { cursor, limit: rawLimit, ...filters } = request.query;
      const limit = normalizeLimit(rawLimit);

      const conditions = [
        eq(appStoreReviews.project_id, projectId),
        isNull(appStoreReviews.deleted_at),
        ...buildFilterConditions(filters),
      ];
      const cursorClause = cursorCondition(cursor);
      if (cursorClause) conditions.push(cursorClause);

      return runReviewsQuery(app, conditions, limit);
    },
  );

  // By-country summary used by the dashboard summary panel + country filter.
  app.get<{ Params: { projectId: string }; Querystring: { app_id?: string; store?: string } }>(
    "/reviews/by-country",
    { preHandler: requirePermission("reviews:read") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { app_id, store } = request.query;
      const conditions = [
        eq(appStoreReviews.project_id, projectId),
        isNull(appStoreReviews.deleted_at),
        isNotNull(appStoreReviews.country_code),
      ];
      if (app_id) conditions.push(eq(appStoreReviews.app_id, app_id));
      if (store && (REVIEW_STORES as readonly string[]).includes(store)) {
        conditions.push(eq(appStoreReviews.store, store));
      }

      const rows = await app.db
        .select({
          country_code: appStoreReviews.country_code,
          review_count: sql<number>`COUNT(*)::int`,
          average_rating: sql<number>`AVG(${appStoreReviews.rating})::float`,
        })
        .from(appStoreReviews)
        .where(and(...conditions))
        .groupBy(appStoreReviews.country_code)
        .orderBy(desc(sql<number>`COUNT(*)`), asc(appStoreReviews.country_code));

      return {
        countries: rows.map((r) => ({
          country_code: r.country_code ?? "",
          review_count: Number(r.review_count),
          average_rating: Math.round(Number(r.average_rating) * 100) / 100,
        })),
      };
    },
  );

  app.get<{ Params: { projectId: string; reviewId: string } }>(
    "/reviews/:reviewId",
    { preHandler: requirePermission("reviews:read") },
    async (request, reply) => {
      const { projectId, reviewId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [row] = await app.db
        .select()
        .from(appStoreReviews)
        .where(
          and(
            eq(appStoreReviews.id, reviewId),
            eq(appStoreReviews.project_id, projectId),
            isNull(appStoreReviews.deleted_at),
          ),
        )
        .limit(1);

      if (!row) return reply.code(404).send({ error: "Review not found" });

      const [appRow] = await app.db
        .select({ name: apps.name })
        .from(apps)
        .where(eq(apps.id, row.app_id))
        .limit(1);

      return serializeReview(row, appRow?.name ?? "");
    },
  );

  // Soft-delete a review (hide from dashboard). User-only — agent keys 403,
  // matching the feedback delete precedent.
  app.delete<{ Params: { projectId: string; reviewId: string } }>(
    "/reviews/:reviewId",
    { preHandler: requirePermission("reviews:write") },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete reviews" });
      }
      const { projectId, reviewId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const deleted = await app.db
        .update(appStoreReviews)
        .set({ deleted_at: new Date() })
        .where(
          and(
            eq(appStoreReviews.id, reviewId),
            eq(appStoreReviews.project_id, projectId),
            isNull(appStoreReviews.deleted_at),
          ),
        )
        .returning({ id: appStoreReviews.id });

      if (deleted.length === 0) {
        return reply.code(404).send({ error: "Review not found" });
      }

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "delete",
        resource_type: "app_store_review",
        resource_id: reviewId,
      });

      return { deleted: true };
    },
  );
}

// Team-scoped listing — mirrors teamFeedbackRoutes so the dashboard's
// "all projects" view works.
export async function teamReviewsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: ReviewsQueryParams & {
      team_id?: string;
      project_id?: string;
      cursor?: string;
      limit?: string;
    };
  }>(
    "/reviews",
    { preHandler: requirePermission("reviews:read") },
    async (request) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);

      const { team_id, project_id, cursor, limit: rawLimit, ...filters } = request.query;
      const limit = normalizeLimit(rawLimit);

      const teamIds = team_id ? (allTeamIds.includes(team_id) ? [team_id] : []) : allTeamIds;
      if (teamIds.length === 0) {
        return { reviews: [], cursor: null, has_more: false };
      }

      const projectConditions = [inArray(projects.team_id, teamIds), isNull(projects.deleted_at)];
      if (project_id) projectConditions.push(eq(projects.id, project_id));
      const accessibleProjects = await app.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(...projectConditions));

      if (accessibleProjects.length === 0) {
        return { reviews: [], cursor: null, has_more: false };
      }

      const projectIds = accessibleProjects.map((p) => p.id);
      const conditions = [
        inArray(appStoreReviews.project_id, projectIds),
        isNull(appStoreReviews.deleted_at),
        ...buildFilterConditions(filters),
      ];
      const cursorClause = cursorCondition(cursor);
      if (cursorClause) conditions.push(cursorClause);

      return runReviewsQuery(app, conditions, limit);
    },
  );
}
