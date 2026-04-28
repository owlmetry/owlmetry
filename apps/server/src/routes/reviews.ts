import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, isNotNull, sql, desc, asc } from "drizzle-orm";
import { appStoreReviews, apps, projects } from "@owlmetry/db";
import {
  INTEGRATION_PROVIDER_IDS,
  MAX_REVIEW_RESPONSE_LENGTH,
  REVIEW_RESPONSE_STATES,
  REVIEW_STORES,
  type ReviewResponseState,
  type ReviewStore,
  type ReviewsQueryParams,
  type UpdateReviewResponseRequest,
} from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { resolveProject } from "../utils/project.js";
import { findActiveIntegration } from "../utils/integrations.js";
import {
  createCustomerReviewResponse,
  deleteCustomerReviewResponse,
  fetchCustomerReviewResponseId,
} from "../utils/app-store-connect/client.js";
import type { AppStoreConnectConfig } from "../utils/app-store-connect/config.js";
import {
  normalizeLimit,
  encodeKeysetCursor,
  decodeKeysetCursor,
} from "../utils/pagination.js";

/**
 * Single-query review-with-app-name load (LEFT JOIN). Returns null when the
 * review doesn't exist for the given project.
 */
async function loadReviewWithAppName(
  app: FastifyInstance,
  projectId: string,
  reviewId: string,
): Promise<{ row: typeof appStoreReviews.$inferSelect; appName: string } | null> {
  const [joined] = await app.db
    .select({
      review: appStoreReviews,
      appName: apps.name,
    })
    .from(appStoreReviews)
    .leftJoin(apps, eq(apps.id, appStoreReviews.app_id))
    .where(and(eq(appStoreReviews.id, reviewId), eq(appStoreReviews.project_id, projectId)))
    .limit(1);
  if (!joined) return null;
  return { row: joined.review, appName: joined.appName ?? "" };
}

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
    developer_response_id: row.developer_response_id,
    developer_response_state: (row.developer_response_state as ReviewResponseState | null) ?? null,
    responded_by_user_id: row.responded_by_user_id,
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
        ...buildFilterConditions(filters),
      ];
      const cursorClause = cursorCondition(cursor);
      if (cursorClause) conditions.push(cursorClause);

      return runReviewsQuery(app, conditions, limit);
    },
  );

  app.get<{ Params: { projectId: string; reviewId: string } }>(
    "/reviews/:reviewId",
    { preHandler: requirePermission("reviews:read") },
    async (request, reply) => {
      const { projectId, reviewId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const loaded = await loadReviewWithAppName(app, projectId, reviewId);
      if (!loaded) return reply.code(404).send({ error: "Review not found" });

      return serializeReview(loaded.row, loaded.appName);
    },
  );

  // Apple has no PATCH for review responses, so editing an existing reply is
  // DELETE-then-POST against ASC. Agent keys with reviews:write are intentionally
  // allowed — the surface (CLI/MCP/iOS/web) handles destructive-action UX.
  app.put<{
    Params: { projectId: string; reviewId: string };
    Body: UpdateReviewResponseRequest;
  }>(
    "/reviews/:reviewId/response",
    { preHandler: requirePermission("reviews:write") },
    async (request, reply) => {
      const { projectId, reviewId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const rawBody = request.body?.body;
      if (typeof rawBody !== "string") {
        return reply.code(400).send({ error: "body is required" });
      }
      const trimmed = rawBody.trim();
      if (!trimmed) {
        return reply.code(400).send({ error: "body is required" });
      }
      if (trimmed.length > MAX_REVIEW_RESPONSE_LENGTH) {
        return reply.code(400).send({
          error: `body exceeds App Store Connect's ${MAX_REVIEW_RESPONSE_LENGTH}-character limit`,
        });
      }

      const [loaded, integration] = await Promise.all([
        loadReviewWithAppName(app, projectId, reviewId),
        findActiveIntegration(app.db, projectId, INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT),
      ]);
      if (!loaded) return reply.code(404).send({ error: "Review not found" });
      const { row, appName } = loaded;
      if (row.store !== "app_store") {
        return reply.code(400).send({
          error: "Replying is only supported for App Store reviews today",
        });
      }
      if (!integration) {
        return reply.code(404).send({
          error: "App Store Connect integration not found or disabled",
        });
      }
      const ascConfig = integration.config as unknown as AppStoreConnectConfig;

      // Delete the existing response (if any) first — Apple has no PATCH, so
      // edit = DELETE-then-POST. If the row has a body but no ASC id (e.g. the
      // reply was created in ASC's web UI before this feature shipped), recover
      // the id via a single GET so we can DELETE it cleanly instead of letting
      // the POST below 409 against the still-live old reply.
      let existingResponseId = row.developer_response_id;
      if (!existingResponseId && row.developer_response) {
        const lookup = await fetchCustomerReviewResponseId(ascConfig, row.external_id);
        if (lookup.status === "auth_error") {
          return reply.code(502).send({ error: lookup.message });
        }
        if (lookup.status === "rate_limited") {
          reply.header("Retry-After", String(lookup.retryAfterSeconds));
          return reply.code(429).send({ error: lookup.message });
        }
        if (lookup.status === "error") {
          return reply
            .code(502)
            .send({ error: `App Store Connect lookup failed: ${lookup.message}` });
        }
        // not_found here means Apple has no response on file, so the local
        // body was stale — fall through to a fresh POST.
        existingResponseId = lookup.status === "found" ? lookup.data : null;
      }

      if (existingResponseId) {
        const deleteResult = await deleteCustomerReviewResponse(ascConfig, existingResponseId);
        if (deleteResult.status === "auth_error") {
          return reply.code(502).send({ error: deleteResult.message });
        }
        if (deleteResult.status === "rate_limited") {
          reply.header("Retry-After", String(deleteResult.retryAfterSeconds));
          return reply.code(429).send({ error: deleteResult.message });
        }
        if (deleteResult.status === "error") {
          return reply
            .code(502)
            .send({ error: `App Store Connect rejected the delete: ${deleteResult.message}` });
        }
        // not_found is acceptable; Apple may have already removed it externally.
      }

      const created = await createCustomerReviewResponse(ascConfig, row.external_id, trimmed);
      if (created.status === "auth_error") {
        return reply.code(502).send({ error: created.message });
      }
      if (created.status === "rate_limited") {
        reply.header("Retry-After", String(created.retryAfterSeconds));
        return reply.code(429).send({ error: created.message });
      }
      if (created.status === "not_found") {
        return reply.code(502).send({
          error: "App Store Connect could not find the review — it may have been deleted on Apple's side",
        });
      }
      if (created.status === "error") {
        return reply
          .code(502)
          .send({ error: `App Store Connect rejected the response: ${created.message}` });
      }

      const respondedAt = created.data.last_modified_at ?? new Date();
      const respondedByUserId = request.auth.type === "user" ? request.auth.user_id : null;

      const [updated] = await app.db
        .update(appStoreReviews)
        .set({
          developer_response: created.data.body,
          developer_response_at: respondedAt,
          developer_response_id: created.data.id,
          developer_response_state: created.data.state,
          responded_by_user_id: respondedByUserId,
        })
        .where(eq(appStoreReviews.id, reviewId))
        .returning();

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "app_store_review",
        resource_id: reviewId,
        metadata: {
          action: existingResponseId ? "edit_response" : "respond",
          state: created.data.state,
        },
      });

      return serializeReview(updated, appName);
    },
  );

  // Delete the developer response on an App Store review. Real ASC mutation —
  // the public reply disappears from the listing. Calling surfaces (CLI/iOS/
  // dashboard/MCP) are expected to confirm with the user before invoking.
  app.delete<{ Params: { projectId: string; reviewId: string } }>(
    "/reviews/:reviewId/response",
    { preHandler: requirePermission("reviews:write") },
    async (request, reply) => {
      const { projectId, reviewId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [loaded, integration] = await Promise.all([
        loadReviewWithAppName(app, projectId, reviewId),
        findActiveIntegration(app.db, projectId, INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT),
      ]);
      if (!loaded) return reply.code(404).send({ error: "Review not found" });
      const { row, appName } = loaded;
      if (!row.developer_response && !row.developer_response_id) {
        return reply.code(404).send({ error: "No reply on file for this review" });
      }
      if (!integration) {
        return reply.code(404).send({
          error: "App Store Connect integration not found or disabled",
        });
      }
      const ascConfig = integration.config as unknown as AppStoreConnectConfig;

      // Recover the ASC response id when the reply was created outside Owlmetry
      // (sync ingested the body but never recorded an id).
      let responseId = row.developer_response_id;
      if (!responseId) {
        const lookup = await fetchCustomerReviewResponseId(ascConfig, row.external_id);
        if (lookup.status === "auth_error") {
          return reply.code(502).send({ error: lookup.message });
        }
        if (lookup.status === "rate_limited") {
          reply.header("Retry-After", String(lookup.retryAfterSeconds));
          return reply.code(429).send({ error: lookup.message });
        }
        if (lookup.status === "error") {
          return reply
            .code(502)
            .send({ error: `App Store Connect lookup failed: ${lookup.message}` });
        }
        if (lookup.status === "not_found") {
          // Apple already removed it externally; clear local fields to match.
          const [cleared] = await app.db
            .update(appStoreReviews)
            .set({
              developer_response: null,
              developer_response_at: null,
              developer_response_id: null,
              developer_response_state: null,
              responded_by_user_id: null,
            })
            .where(eq(appStoreReviews.id, reviewId))
            .returning();
          logAuditEvent(app.db, request.auth, {
            team_id: project.team_id,
            action: "update",
            resource_type: "app_store_review",
            resource_id: reviewId,
            metadata: { action: "delete_response", note: "already removed on Apple's side" },
          });
          return serializeReview(cleared, appName);
        }
        responseId = lookup.data;
      }

      const result = await deleteCustomerReviewResponse(ascConfig, responseId);
      if (result.status === "auth_error") {
        return reply.code(502).send({ error: result.message });
      }
      if (result.status === "rate_limited") {
        reply.header("Retry-After", String(result.retryAfterSeconds));
        return reply.code(429).send({ error: result.message });
      }
      if (result.status === "error") {
        return reply
          .code(502)
          .send({ error: `App Store Connect rejected the delete: ${result.message}` });
      }
      // not_found is success — Apple already removed it externally.

      const [updated] = await app.db
        .update(appStoreReviews)
        .set({
          developer_response: null,
          developer_response_at: null,
          developer_response_id: null,
          developer_response_state: null,
          responded_by_user_id: null,
        })
        .where(eq(appStoreReviews.id, reviewId))
        .returning();

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "app_store_review",
        resource_id: reviewId,
        metadata: { action: "delete_response" },
      });

      return serializeReview(updated, appName);
    },
  );
}

// Team-scoped listing — mirrors teamFeedbackRoutes so the dashboard's
// "all projects" view works.
export async function teamReviewsRoutes(app: FastifyInstance) {
  // Lightweight count endpoint for the dashboard stat card. Returns total
  // reviews across every project the caller can see. Optionally narrowed to a
  // single team or project.
  app.get<{ Querystring: { team_id?: string; project_id?: string; since?: string } }>(
    "/reviews/count",
    { preHandler: requirePermission("reviews:read") },
    async (request) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      const { team_id, project_id, since } = request.query;

      const teamIds = team_id ? (allTeamIds.includes(team_id) ? [team_id] : []) : allTeamIds;
      if (teamIds.length === 0) return { count: 0 };

      const projectConditions = [inArray(projects.team_id, teamIds), isNull(projects.deleted_at)];
      if (project_id) projectConditions.push(eq(projects.id, project_id));
      const accessibleProjects = await app.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(...projectConditions));
      if (accessibleProjects.length === 0) return { count: 0 };

      const projectIds = accessibleProjects.map((p) => p.id);
      const conditions = [inArray(appStoreReviews.project_id, projectIds)];
      if (since) {
        conditions.push(sql`${appStoreReviews.created_at_in_store} >= ${since}::timestamptz`);
      }

      const [row] = await app.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(appStoreReviews)
        .where(and(...conditions));
      return { count: Number(row?.count ?? 0) };
    },
  );

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
        ...buildFilterConditions(filters),
      ];
      const cursorClause = cursorCondition(cursor);
      if (cursorClause) conditions.push(cursorClause);

      return runReviewsQuery(app, conditions, limit);
    },
  );
}
