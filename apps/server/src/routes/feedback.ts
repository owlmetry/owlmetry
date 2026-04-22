import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, or, sql, desc } from "drizzle-orm";
import {
  feedback,
  feedbackComments,
  apps,
  projects,
  appUsers,
} from "@owlmetry/db";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  FEEDBACK_STATUSES,
} from "@owlmetry/shared";
import type {
  FeedbackStatus,
  FeedbackQueryParams,
  UpdateFeedbackRequest,
  CreateFeedbackCommentRequest,
  UpdateFeedbackCommentRequest,
} from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { resolveProject } from "../utils/project.js";
import { dataModeToDrizzle } from "../utils/data-mode.js";
import { normalizeLimit, encodeKeysetCursor, decodeKeysetCursor } from "../utils/pagination.js";
import { resolveCommentAuthor } from "../utils/comment-author.js";

function serializeFeedback(
  row: typeof feedback.$inferSelect,
  appName?: string,
  projectName?: string,
  userProperties?: Record<string, string> | null,
) {
  return {
    id: row.id,
    app_id: row.app_id,
    project_id: row.project_id,
    session_id: row.session_id,
    user_id: row.user_id,
    message: row.message,
    submitter_name: row.submitter_name,
    submitter_email: row.submitter_email,
    status: row.status,
    is_dev: row.is_dev,
    environment: row.environment,
    os_version: row.os_version,
    app_version: row.app_version,
    device_model: row.device_model,
    country_code: row.country_code,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    ...(appName !== undefined ? { app_name: appName } : {}),
    ...(projectName !== undefined ? { project_name: projectName } : {}),
    ...(userProperties !== undefined ? { user_properties: userProperties } : {}),
  };
}

/**
 * Batch-fetch `app_users.properties` for every distinct (project_id, user_id)
 * referenced by a page of feedback rows. Single OR-of-ANDs query so even
 * cross-project team listings don't N+1. The map key is `${project_id}:${user_id}`.
 */
async function loadUserPropertiesForFeedback(
  db: FastifyInstance["db"],
  rows: Array<{ project_id: string; user_id: string | null }>,
): Promise<Map<string, Record<string, string> | null>> {
  const byProject = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.user_id) continue;
    let set = byProject.get(row.project_id);
    if (!set) {
      set = new Set();
      byProject.set(row.project_id, set);
    }
    set.add(row.user_id);
  }
  if (byProject.size === 0) return new Map();

  const conditions = [...byProject.entries()].map(([projectId, userIds]) =>
    and(
      eq(appUsers.project_id, projectId),
      inArray(appUsers.user_id, [...userIds]),
    ),
  );

  const found = await db
    .select({
      project_id: appUsers.project_id,
      user_id: appUsers.user_id,
      properties: appUsers.properties,
    })
    .from(appUsers)
    .where(or(...conditions));

  const map = new Map<string, Record<string, string> | null>();
  for (const u of found) {
    map.set(`${u.project_id}:${u.user_id}`, u.properties ?? null);
  }
  return map;
}

function serializeFeedbackComment(row: typeof feedbackComments.$inferSelect) {
  return {
    id: row.id,
    feedback_id: row.feedback_id,
    author_type: row.author_type as "user" | "agent",
    author_id: row.author_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function feedbackRoutes(app: FastifyInstance) {
  app.get<{ Params: { projectId: string }; Querystring: FeedbackQueryParams }>(
    "/feedback",
    { preHandler: requirePermission("feedback:read") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { status, app_id, is_dev, data_mode, cursor, limit: limitStr } = request.query;
      const limit = Math.min(
        Math.max(parseInt(limitStr || "", 10) || DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE
      );

      const conditions = [eq(feedback.project_id, projectId), isNull(feedback.deleted_at)];
      if (status && FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
        conditions.push(eq(feedback.status, status as FeedbackStatus));
      }
      if (app_id) {
        conditions.push(eq(feedback.app_id, app_id));
      }
      if (is_dev !== undefined) {
        conditions.push(eq(feedback.is_dev, is_dev === "true"));
      } else {
        const devCondition = dataModeToDrizzle(feedback.is_dev, data_mode as any);
        if (devCondition) conditions.push(devCondition);
      }

      if (cursor) {
        const decoded = decodeKeysetCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${feedback.created_at} < ${decoded.timestamp}::timestamptz OR (${feedback.created_at} = ${decoded.timestamp}::timestamptz AND ${feedback.id} < ${decoded.id}))`
          );
        }
      }

      const rows = await app.db
        .select()
        .from(feedback)
        .where(and(...conditions))
        .orderBy(desc(feedback.created_at), desc(feedback.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const appIds = [...new Set(page.map((r) => r.app_id))];
      const [appRows, userPropsMap] = await Promise.all([
        appIds.length > 0
          ? app.db.select({ id: apps.id, name: apps.name }).from(apps).where(inArray(apps.id, appIds))
          : Promise.resolve([] as Array<{ id: string; name: string }>),
        loadUserPropertiesForFeedback(app.db, page),
      ]);
      const appNameMap = new Map(appRows.map((a) => [a.id, a.name]));

      const lastItem = page[page.length - 1];
      return {
        feedback: page.map((r) =>
          serializeFeedback(
            r,
            appNameMap.get(r.app_id),
            undefined,
            r.user_id ? userPropsMap.get(`${r.project_id}:${r.user_id}`) ?? null : null,
          ),
        ),
        cursor: hasMore && lastItem ? encodeKeysetCursor(lastItem.created_at, lastItem.id) : null,
        has_more: hasMore,
      };
    }
  );

  app.get<{ Params: { projectId: string; feedbackId: string } }>(
    "/feedback/:feedbackId",
    { preHandler: requirePermission("feedback:read") },
    async (request, reply) => {
      const { projectId, feedbackId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [row] = await app.db
        .select()
        .from(feedback)
        .where(
          and(
            eq(feedback.id, feedbackId),
            eq(feedback.project_id, projectId),
            isNull(feedback.deleted_at)
          )
        )
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "Feedback not found" });
      }

      const [[appRow], commentRows, userPropsMap] = await Promise.all([
        app.db.select({ name: apps.name }).from(apps).where(eq(apps.id, row.app_id)).limit(1),
        app.db
          .select()
          .from(feedbackComments)
          .where(
            and(
              eq(feedbackComments.feedback_id, feedbackId),
              isNull(feedbackComments.deleted_at)
            )
          )
          .orderBy(feedbackComments.created_at),
        loadUserPropertiesForFeedback(app.db, [row]),
      ]);

      return {
        ...serializeFeedback(
          row,
          appRow?.name,
          undefined,
          row.user_id ? userPropsMap.get(`${row.project_id}:${row.user_id}`) ?? null : null,
        ),
        comments: commentRows.map(serializeFeedbackComment),
      };
    }
  );

  app.patch<{ Params: { projectId: string; feedbackId: string }; Body: UpdateFeedbackRequest }>(
    "/feedback/:feedbackId",
    { preHandler: requirePermission("feedback:write") },
    async (request, reply) => {
      const { projectId, feedbackId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { status } = request.body ?? {};
      if (!status) {
        return reply.code(400).send({ error: "status is required" });
      }
      if (!FEEDBACK_STATUSES.includes(status)) {
        return reply.code(400).send({
          error: `Invalid status. Must be one of: ${FEEDBACK_STATUSES.join(", ")}`,
        });
      }

      // Single UPDATE … RETURNING closes a TOCTOU vs. a concurrent delete and
      // matches `isNull(deleted_at)` so we can't resurrect a deleted row.
      const [updated] = await app.db
        .update(feedback)
        .set({ status })
        .where(
          and(
            eq(feedback.id, feedbackId),
            eq(feedback.project_id, projectId),
            isNull(feedback.deleted_at)
          )
        )
        .returning();

      if (!updated) {
        return reply.code(404).send({ error: "Feedback not found" });
      }

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "feedback",
        resource_id: feedbackId,
        changes: { status: { after: status } },
      });

      return serializeFeedback(updated);
    }
  );

  // Soft-delete feedback — user-only (agent keys get 403 by design).
  app.delete<{ Params: { projectId: string; feedbackId: string } }>(
    "/feedback/:feedbackId",
    { preHandler: requirePermission("feedback:write") },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete feedback" });
      }

      const { projectId, feedbackId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const deleted = await app.db
        .update(feedback)
        .set({ deleted_at: new Date() })
        .where(
          and(
            eq(feedback.id, feedbackId),
            eq(feedback.project_id, projectId),
            isNull(feedback.deleted_at)
          )
        )
        .returning({ id: feedback.id });

      if (deleted.length === 0) {
        return reply.code(404).send({ error: "Feedback not found" });
      }

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "delete",
        resource_type: "feedback",
        resource_id: feedbackId,
      });

      return { deleted: true };
    }
  );

  app.post<{
    Params: { projectId: string; feedbackId: string };
    Body: CreateFeedbackCommentRequest;
  }>(
    "/feedback/:feedbackId/comments",
    { preHandler: requirePermission("feedback:write") },
    async (request, reply) => {
      const { projectId, feedbackId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { body } = request.body ?? { body: "" };
      if (!body || !body.trim()) {
        return reply.code(400).send({ error: "body is required" });
      }

      // Existence check and author-name lookup are independent.
      const [[row], author] = await Promise.all([
        app.db
          .select({ id: feedback.id })
          .from(feedback)
          .where(
            and(
              eq(feedback.id, feedbackId),
              eq(feedback.project_id, projectId),
              isNull(feedback.deleted_at)
            )
          )
          .limit(1),
        resolveCommentAuthor(app.db, request.auth),
      ]);

      if (!row) return reply.code(404).send({ error: "Feedback not found" });

      const [created] = await app.db
        .insert(feedbackComments)
        .values({
          feedback_id: feedbackId,
          author_type: author.authorType,
          author_id: author.authorId,
          author_name: author.authorName,
          body: body.trim(),
        })
        .returning();

      return reply.code(201).send(serializeFeedbackComment(created));
    }
  );

  app.patch<{
    Params: { projectId: string; feedbackId: string; commentId: string };
    Body: UpdateFeedbackCommentRequest;
  }>(
    "/feedback/:feedbackId/comments/:commentId",
    { preHandler: requirePermission("feedback:write") },
    async (request, reply) => {
      const { projectId, feedbackId, commentId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { body } = request.body ?? { body: "" };
      if (!body || !body.trim()) {
        return reply.code(400).send({ error: "body is required" });
      }

      const [comment] = await app.db
        .select()
        .from(feedbackComments)
        .where(
          and(
            eq(feedbackComments.id, commentId),
            eq(feedbackComments.feedback_id, feedbackId),
            isNull(feedbackComments.deleted_at)
          )
        )
        .limit(1);

      if (!comment) return reply.code(404).send({ error: "Comment not found" });

      const auth = request.auth;
      const actorId = auth.type === "user" ? auth.user_id : auth.key_id;
      if (comment.author_id !== actorId) {
        return reply
          .code(403)
          .send({ error: "Only the original author can edit this comment" });
      }

      const [updated] = await app.db
        .update(feedbackComments)
        .set({ body: body.trim() })
        .where(eq(feedbackComments.id, commentId))
        .returning();

      return serializeFeedbackComment(updated);
    }
  );

  app.delete<{
    Params: { projectId: string; feedbackId: string; commentId: string };
  }>(
    "/feedback/:feedbackId/comments/:commentId",
    { preHandler: requirePermission("feedback:write") },
    async (request, reply) => {
      const { projectId, feedbackId, commentId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [comment] = await app.db
        .select()
        .from(feedbackComments)
        .where(
          and(
            eq(feedbackComments.id, commentId),
            eq(feedbackComments.feedback_id, feedbackId),
            isNull(feedbackComments.deleted_at)
          )
        )
        .limit(1);

      if (!comment) return reply.code(404).send({ error: "Comment not found" });

      const auth = request.auth;
      const actorId = auth.type === "user" ? auth.user_id : auth.key_id;
      if (comment.author_id !== actorId) {
        if (auth.type !== "user") {
          return reply
            .code(403)
            .send({ error: "Only the original author or a team admin can delete this comment" });
        }
        const membership = auth.team_memberships?.find((t) => t.team_id === project.team_id);
        if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
          return reply
            .code(403)
            .send({ error: "Only the original author or a team admin can delete this comment" });
        }
      }

      await app.db
        .update(feedbackComments)
        .set({ deleted_at: new Date() })
        .where(eq(feedbackComments.id, commentId));

      return { deleted: true };
    }
  );
}

export async function teamFeedbackRoutes(app: FastifyInstance) {
  app.get<{ Querystring: FeedbackQueryParams }>(
    "/feedback",
    { preHandler: requirePermission("feedback:read") },
    async (request) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);

      const {
        team_id,
        project_id,
        status,
        app_id,
        is_dev,
        data_mode,
        cursor,
        limit: rawLimit,
      } = request.query;
      const limit = normalizeLimit(rawLimit);

      const teamIds = team_id
        ? allTeamIds.includes(team_id)
          ? [team_id]
          : []
        : allTeamIds;

      if (teamIds.length === 0) {
        return { feedback: [], cursor: null, has_more: false };
      }

      const projectConditions = [inArray(projects.team_id, teamIds), isNull(projects.deleted_at)];
      if (project_id) {
        projectConditions.push(eq(projects.id, project_id));
      }
      const accessibleProjects = await app.db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(...projectConditions));

      if (accessibleProjects.length === 0) {
        return { feedback: [], cursor: null, has_more: false };
      }

      const projectIds = accessibleProjects.map((p) => p.id);
      const projectNameMap = new Map(accessibleProjects.map((p) => [p.id, p.name]));

      const conditions = [inArray(feedback.project_id, projectIds), isNull(feedback.deleted_at)];
      if (status && FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
        conditions.push(eq(feedback.status, status as FeedbackStatus));
      }
      if (app_id) {
        conditions.push(eq(feedback.app_id, app_id));
      }
      if (is_dev !== undefined) {
        conditions.push(eq(feedback.is_dev, is_dev === "true"));
      } else {
        const devCondition = dataModeToDrizzle(feedback.is_dev, data_mode as any);
        if (devCondition) conditions.push(devCondition);
      }

      if (cursor) {
        const decoded = decodeKeysetCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${feedback.created_at} < ${decoded.timestamp}::timestamptz OR (${feedback.created_at} = ${decoded.timestamp}::timestamptz AND ${feedback.id} < ${decoded.id}))`
          );
        }
      }

      const rows = await app.db
        .select()
        .from(feedback)
        .where(and(...conditions))
        .orderBy(desc(feedback.created_at), desc(feedback.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const appIds = [...new Set(page.map((r) => r.app_id))];
      const [appRows, userPropsMap] = await Promise.all([
        appIds.length > 0
          ? app.db.select({ id: apps.id, name: apps.name }).from(apps).where(inArray(apps.id, appIds))
          : Promise.resolve([] as Array<{ id: string; name: string }>),
        loadUserPropertiesForFeedback(app.db, page),
      ]);
      const appNameMap = new Map(appRows.map((a) => [a.id, a.name]));

      const lastItem = page[page.length - 1];
      return {
        feedback: page.map((r) =>
          serializeFeedback(
            r,
            appNameMap.get(r.app_id),
            projectNameMap.get(r.project_id),
            r.user_id ? userPropsMap.get(`${r.project_id}:${r.user_id}`) ?? null : null,
          ),
        ),
        cursor: hasMore && lastItem ? encodeKeysetCursor(lastItem.created_at, lastItem.id) : null,
        has_more: hasMore,
      };
    }
  );
}
