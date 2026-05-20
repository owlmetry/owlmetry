import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, or, sql, desc, gte } from "drizzle-orm";

const countAll = sql<number>`COUNT(*)::int`;
import {
  questionnaires,
  questionnaireResponses,
  questionnaireResponseComments,
  apps,
  appUsers,
  projects,
} from "@owlmetry/db";
import {
  QUESTIONNAIRE_RESPONSE_STATUSES,
  QUESTIONNAIRE_SLUG_REGEX,
  MAX_QUESTIONNAIRE_SLUG_LENGTH,
  MAX_QUESTIONNAIRE_NAME_LENGTH,
  MAX_QUESTIONNAIRE_DESCRIPTION_LENGTH,
  validateQuestionnaireSchema,
  parseTimeParam,
} from "@owlmetry/shared";
import type {
  DataMode,
  QuestionnaireResponseStatus,
  QuestionnaireQueryParams,
  QuestionnaireResponseQueryParams,
  CreateQuestionnaireRequest,
  UpdateQuestionnaireRequest,
  UpdateQuestionnaireResponseRequest,
  CreateQuestionnaireResponseCommentRequest,
  UpdateQuestionnaireResponseCommentRequest,
  QuestionnaireSchema,
  QuestionnaireQuestionAnalytics,
  QuestionnaireAnalyticsResponse,
  QuestionnaireRatingBucket,
  QuestionnaireChoiceCount,
} from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { resolveProject } from "../utils/project.js";
import { dataModeToDrizzle } from "../utils/data-mode.js";
import { normalizeLimit, encodeKeysetCursor, decodeKeysetCursor } from "../utils/pagination.js";
import { resolveCommentAuthor } from "../utils/comment-author.js";

function serializeQuestionnaire(
  row: typeof questionnaires.$inferSelect,
  responseCount?: number,
  lastResponseAt?: Date | string | null,
  submittedCount?: number,
) {
  const lastIso =
    lastResponseAt == null
      ? null
      : lastResponseAt instanceof Date
        ? lastResponseAt.toISOString()
        : new Date(lastResponseAt).toISOString();
  return {
    id: row.id,
    project_id: row.project_id,
    app_id: row.app_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    schema: row.schema as QuestionnaireSchema,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    ...(responseCount !== undefined ? { response_count: responseCount } : {}),
    ...(submittedCount !== undefined ? { submitted_count: submittedCount } : {}),
    ...(lastResponseAt !== undefined ? { last_response_at: lastIso } : {}),
  };
}

function serializeResponse(
  row: typeof questionnaireResponses.$inferSelect,
  questionnaireName?: string,
  questionnaireSlug?: string,
  appName?: string,
  userProperties?: Record<string, string> | null,
) {
  return {
    id: row.id,
    questionnaire_id: row.questionnaire_id,
    slug: row.slug,
    app_id: row.app_id,
    project_id: row.project_id,
    session_id: row.session_id,
    user_id: row.user_id,
    answers: row.answers as Record<string, unknown>,
    // schema_snapshot is null on draft rows — they render against the live
    // questionnaires.schema. Consumers can detect a draft by either this
    // field being null or the dedicated is_complete flag below.
    schema_snapshot: (row.schema_snapshot as QuestionnaireSchema | null) ?? null,
    submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
    is_complete: row.submitted_at !== null,
    status: row.status,
    is_dev: row.is_dev,
    environment: row.environment,
    os_version: row.os_version,
    app_version: row.app_version,
    sdk_name: row.sdk_name,
    sdk_version: row.sdk_version,
    device_model: row.device_model,
    country_code: row.country_code,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    ...(questionnaireName !== undefined ? { questionnaire_name: questionnaireName } : {}),
    ...(questionnaireSlug !== undefined ? { questionnaire_slug: questionnaireSlug } : {}),
    ...(appName !== undefined ? { app_name: appName } : {}),
    ...(userProperties !== undefined ? { user_properties: userProperties } : {}),
  };
}

function serializeResponseComment(row: typeof questionnaireResponseComments.$inferSelect) {
  return {
    id: row.id,
    questionnaire_response_id: row.questionnaire_response_id,
    author_type: row.author_type as "user" | "agent",
    author_id: row.author_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Batch-load app_users.properties for rows referencing real (non-anon) users. */
async function loadUserPropertiesForRows(
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
    and(eq(appUsers.project_id, projectId), inArray(appUsers.user_id, [...userIds])),
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

/**
 * Roll up response_count + submitted_count + last_response_at per
 * questionnaire in a single GROUP BY query. `count` includes drafts and
 * submitted (drafts are responses); `submitted` is the subset with
 * submitted_at IS NOT NULL. Empty input returns an empty map.
 */
async function loadResponseCountsByQuestionnaire(
  db: FastifyInstance["db"],
  questionnaireIds: string[],
  dataMode?: DataMode,
): Promise<Map<string, { count: number; submitted: number; last: Date | null }>> {
  const map = new Map<string, { count: number; submitted: number; last: Date | null }>();
  if (questionnaireIds.length === 0) return map;
  const conditions = [
    inArray(questionnaireResponses.questionnaire_id, questionnaireIds),
    isNull(questionnaireResponses.deleted_at),
  ];
  const devCondition = dataModeToDrizzle(questionnaireResponses.is_dev, dataMode);
  if (devCondition) conditions.push(devCondition);
  const counts = await db
    .select({
      questionnaire_id: questionnaireResponses.questionnaire_id,
      count: countAll,
      submitted: sql<number>`COUNT(*) FILTER (WHERE ${questionnaireResponses.submitted_at} IS NOT NULL)`,
      last: sql<Date | null>`MAX(${questionnaireResponses.created_at})`,
    })
    .from(questionnaireResponses)
    .where(and(...conditions))
    .groupBy(questionnaireResponses.questionnaire_id);
  for (const c of counts) {
    map.set(c.questionnaire_id, {
      count: Number(c.count),
      submitted: Number(c.submitted),
      last: c.last,
    });
  }
  return map;
}

export async function questionnaireRoutes(app: FastifyInstance) {
  // --- Questionnaire definitions ---

  app.get<{ Params: { projectId: string }; Querystring: QuestionnaireQueryParams }>(
    "/questionnaires",
    { preHandler: requirePermission("questionnaires:read") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { app_id, is_active, data_mode, cursor, limit: limitStr } = request.query;
      const limit = normalizeLimit(limitStr);

      const conditions = [eq(questionnaires.project_id, projectId), isNull(questionnaires.deleted_at)];
      if (app_id) conditions.push(eq(questionnaires.app_id, app_id));
      if (is_active !== undefined) conditions.push(eq(questionnaires.is_active, is_active === "true"));

      if (cursor) {
        const decoded = decodeKeysetCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${questionnaires.created_at} < ${decoded.timestamp}::timestamptz OR (${questionnaires.created_at} = ${decoded.timestamp}::timestamptz AND ${questionnaires.id} < ${decoded.id}))`,
          );
        }
      }

      const rows = await app.db
        .select()
        .from(questionnaires)
        .where(and(...conditions))
        .orderBy(desc(questionnaires.created_at), desc(questionnaires.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const countsById = await loadResponseCountsByQuestionnaire(
        app.db,
        page.map((r) => r.id),
        data_mode as DataMode | undefined,
      );

      const lastItem = page[page.length - 1];
      return {
        questionnaires: page.map((r) => {
          const counts = countsById.get(r.id);
          return serializeQuestionnaire(
            r,
            counts?.count ?? 0,
            counts?.last ?? null,
            counts?.submitted ?? 0,
          );
        }),
        cursor: hasMore && lastItem ? encodeKeysetCursor(lastItem.created_at, lastItem.id) : null,
        has_more: hasMore,
      };
    },
  );

  app.post<{ Params: { projectId: string }; Body: CreateQuestionnaireRequest }>(
    "/questionnaires",
    { preHandler: requirePermission("questionnaires:write") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const body = request.body ?? ({} as CreateQuestionnaireRequest);

      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      if (!slug || slug.length > MAX_QUESTIONNAIRE_SLUG_LENGTH || !QUESTIONNAIRE_SLUG_REGEX.test(slug)) {
        return reply.code(400).send({
          error: `slug must be 1-${MAX_QUESTIONNAIRE_SLUG_LENGTH} lowercase letters/digits/hyphens`,
        });
      }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > MAX_QUESTIONNAIRE_NAME_LENGTH) {
        return reply.code(400).send({ error: `name must be 1-${MAX_QUESTIONNAIRE_NAME_LENGTH} chars` });
      }
      const description = trimOptional(body.description, MAX_QUESTIONNAIRE_DESCRIPTION_LENGTH);
      if (description === undefined) {
        return reply.code(400).send({ error: `description must be at most ${MAX_QUESTIONNAIRE_DESCRIPTION_LENGTH} chars` });
      }

      const schemaResult = validateQuestionnaireSchema(body.schema);
      if (!schemaResult.ok) return reply.code(400).send({ error: schemaResult.error });

      const appId = body.app_id ?? null;
      if (appId) {
        const [appRow] = await app.db
          .select({ id: apps.id, project_id: apps.project_id })
          .from(apps)
          .where(and(eq(apps.id, appId), isNull(apps.deleted_at)))
          .limit(1);
        if (!appRow || appRow.project_id !== projectId) {
          return reply.code(400).send({ error: "app_id does not belong to this project" });
        }
      }

      // Slug conflict among non-deleted rows → 409. (Slug reuse after
      // soft-delete is supported at the application layer; not exposed here.)
      const [existing] = await app.db
        .select({ id: questionnaires.id })
        .from(questionnaires)
        .where(
          and(
            eq(questionnaires.project_id, projectId),
            eq(questionnaires.slug, slug),
            isNull(questionnaires.deleted_at),
          ),
        )
        .limit(1);
      if (existing) {
        return reply.code(409).send({ error: `A questionnaire with slug "${slug}" already exists in this project` });
      }

      const [created] = await app.db
        .insert(questionnaires)
        .values({
          project_id: projectId,
          app_id: appId,
          slug,
          name,
          description,
          schema: schemaResult.value,
          is_active: body.is_active ?? true,
        })
        .returning();

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "create",
        resource_type: "questionnaire",
        resource_id: created.id,
      });

      return reply.code(201).send(serializeQuestionnaire(created, 0, null));
    },
  );

  app.get<{
    Params: { projectId: string; questionnaireId: string };
    Querystring: { data_mode?: string };
  }>(
    "/questionnaires/:questionnaireId",
    { preHandler: requirePermission("questionnaires:read") },
    async (request, reply) => {
      const { projectId, questionnaireId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [row] = await app.db
        .select()
        .from(questionnaires)
        .where(
          and(
            eq(questionnaires.id, questionnaireId),
            eq(questionnaires.project_id, projectId),
            isNull(questionnaires.deleted_at),
          ),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: "Questionnaire not found" });

      const countsById = await loadResponseCountsByQuestionnaire(
        app.db,
        [questionnaireId],
        request.query.data_mode as DataMode | undefined,
      );
      const stats = countsById.get(questionnaireId);

      return serializeQuestionnaire(
        row,
        stats?.count ?? 0,
        stats?.last ?? null,
        stats?.submitted ?? 0,
      );
    },
  );

  app.patch<{ Params: { projectId: string; questionnaireId: string }; Body: UpdateQuestionnaireRequest }>(
    "/questionnaires/:questionnaireId",
    { preHandler: requirePermission("questionnaires:write") },
    async (request, reply) => {
      const { projectId, questionnaireId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const body = request.body ?? {};
      if ("slug" in body) {
        return reply.code(400).send({ error: "slug is immutable after creation" });
      }

      const patch: Partial<typeof questionnaires.$inferInsert> = {};
      const changes: Record<string, { after: unknown }> = {};

      if (body.name !== undefined) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > MAX_QUESTIONNAIRE_NAME_LENGTH) {
          return reply.code(400).send({ error: `name must be 1-${MAX_QUESTIONNAIRE_NAME_LENGTH} chars` });
        }
        patch.name = name;
        changes.name = { after: name };
      }
      if (body.description !== undefined) {
        const description = trimOptional(body.description, MAX_QUESTIONNAIRE_DESCRIPTION_LENGTH);
        if (description === undefined) {
          return reply.code(400).send({ error: `description must be at most ${MAX_QUESTIONNAIRE_DESCRIPTION_LENGTH} chars` });
        }
        patch.description = description;
        changes.description = { after: description };
      }
      if (body.schema !== undefined) {
        const schemaResult = validateQuestionnaireSchema(body.schema);
        if (!schemaResult.ok) return reply.code(400).send({ error: schemaResult.error });
        patch.schema = schemaResult.value;
        changes.schema = { after: "<updated>" };
      }
      if (body.is_active !== undefined) {
        patch.is_active = body.is_active === true;
        changes.is_active = { after: patch.is_active };
      }
      if (body.app_id !== undefined) {
        const appId = body.app_id ?? null;
        if (appId) {
          const [appRow] = await app.db
            .select({ id: apps.id, project_id: apps.project_id })
            .from(apps)
            .where(and(eq(apps.id, appId), isNull(apps.deleted_at)))
            .limit(1);
          if (!appRow || appRow.project_id !== projectId) {
            return reply.code(400).send({ error: "app_id does not belong to this project" });
          }
        }
        patch.app_id = appId;
        changes.app_id = { after: appId };
      }

      if (Object.keys(patch).length === 0) {
        return reply.code(400).send({ error: "no editable fields provided" });
      }

      const [updated] = await app.db
        .update(questionnaires)
        .set(patch)
        .where(
          and(
            eq(questionnaires.id, questionnaireId),
            eq(questionnaires.project_id, projectId),
            isNull(questionnaires.deleted_at),
          ),
        )
        .returning();
      if (!updated) return reply.code(404).send({ error: "Questionnaire not found" });

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "questionnaire",
        resource_id: questionnaireId,
        changes,
      });

      return serializeQuestionnaire(updated);
    },
  );

  app.delete<{ Params: { projectId: string; questionnaireId: string } }>(
    "/questionnaires/:questionnaireId",
    { preHandler: requirePermission("questionnaires:write") },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete questionnaires" });
      }
      const { projectId, questionnaireId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const deleted = await app.db
        .update(questionnaires)
        .set({ deleted_at: new Date(), is_active: false })
        .where(
          and(
            eq(questionnaires.id, questionnaireId),
            eq(questionnaires.project_id, projectId),
            isNull(questionnaires.deleted_at),
          ),
        )
        .returning({ id: questionnaires.id });
      if (deleted.length === 0) return reply.code(404).send({ error: "Questionnaire not found" });

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "delete",
        resource_type: "questionnaire",
        resource_id: questionnaireId,
      });

      return { deleted: true };
    },
  );

  // --- Responses ---

  app.get<{
    Params: { projectId: string; questionnaireId: string };
    Querystring: QuestionnaireResponseQueryParams;
  }>(
    "/questionnaires/:questionnaireId/responses",
    { preHandler: requirePermission("questionnaires:read") },
    async (request, reply) => {
      const { projectId, questionnaireId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      // Verify the parent exists and belongs to this project.
      const [parent] = await app.db
        .select({ id: questionnaires.id, name: questionnaires.name, slug: questionnaires.slug })
        .from(questionnaires)
        .where(
          and(
            eq(questionnaires.id, questionnaireId),
            eq(questionnaires.project_id, projectId),
            isNull(questionnaires.deleted_at),
          ),
        )
        .limit(1);
      if (!parent) return reply.code(404).send({ error: "Questionnaire not found" });

      const { status, app_id, is_dev, data_mode, submitted_only, cursor, limit: limitStr } = request.query;
      const limit = normalizeLimit(limitStr);

      const conditions = [
        eq(questionnaireResponses.questionnaire_id, questionnaireId),
        isNull(questionnaireResponses.deleted_at),
      ];
      if (status && QUESTIONNAIRE_RESPONSE_STATUSES.includes(status as QuestionnaireResponseStatus)) {
        conditions.push(eq(questionnaireResponses.status, status as QuestionnaireResponseStatus));
      }
      if (app_id) conditions.push(eq(questionnaireResponses.app_id, app_id));
      if (is_dev !== undefined) {
        conditions.push(eq(questionnaireResponses.is_dev, is_dev === "true"));
      } else {
        const devCondition = dataModeToDrizzle(questionnaireResponses.is_dev, data_mode as DataMode);
        if (devCondition) conditions.push(devCondition);
      }
      // Drafts (submitted_at IS NULL) are included by default so dashboards can
      // see drop-off; consumers who explicitly want completed-only pass
      // submitted_only=true. The submitted_at IS NULL `?status=draft` filter
      // remains available for the inverse case.
      if (submitted_only === "true") {
        conditions.push(sql`${questionnaireResponses.submitted_at} IS NOT NULL`);
      }
      if (cursor) {
        const decoded = decodeKeysetCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${questionnaireResponses.created_at} < ${decoded.timestamp}::timestamptz OR (${questionnaireResponses.created_at} = ${decoded.timestamp}::timestamptz AND ${questionnaireResponses.id} < ${decoded.id}))`,
          );
        }
      }

      const rows = await app.db
        .select()
        .from(questionnaireResponses)
        .where(and(...conditions))
        .orderBy(desc(questionnaireResponses.created_at), desc(questionnaireResponses.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const appIds = [...new Set(page.map((r) => r.app_id))];
      const [appRows, userPropsMap] = await Promise.all([
        appIds.length > 0
          ? app.db.select({ id: apps.id, name: apps.name }).from(apps).where(inArray(apps.id, appIds))
          : Promise.resolve([] as Array<{ id: string; name: string }>),
        loadUserPropertiesForRows(app.db, page),
      ]);
      const appNameMap = new Map(appRows.map((a) => [a.id, a.name]));

      const lastItem = page[page.length - 1];
      return {
        responses: page.map((r) =>
          serializeResponse(
            r,
            parent.name,
            parent.slug,
            appNameMap.get(r.app_id),
            r.user_id ? userPropsMap.get(`${r.project_id}:${r.user_id}`) ?? null : null,
          ),
        ),
        cursor: hasMore && lastItem ? encodeKeysetCursor(lastItem.created_at, lastItem.id) : null,
        has_more: hasMore,
      };
    },
  );

  app.get<{ Params: { projectId: string; questionnaireId: string; responseId: string } }>(
    "/questionnaires/:questionnaireId/responses/:responseId",
    { preHandler: requirePermission("questionnaires:read") },
    async (request, reply) => {
      const { projectId, questionnaireId, responseId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [row] = await app.db
        .select()
        .from(questionnaireResponses)
        .where(
          and(
            eq(questionnaireResponses.id, responseId),
            eq(questionnaireResponses.questionnaire_id, questionnaireId),
            eq(questionnaireResponses.project_id, projectId),
            isNull(questionnaireResponses.deleted_at),
          ),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: "Response not found" });

      const [[parent], [appRow], commentRows, userPropsMap] = await Promise.all([
        app.db
          .select({ name: questionnaires.name, slug: questionnaires.slug })
          .from(questionnaires)
          .where(eq(questionnaires.id, questionnaireId))
          .limit(1),
        app.db.select({ name: apps.name }).from(apps).where(eq(apps.id, row.app_id)).limit(1),
        app.db
          .select()
          .from(questionnaireResponseComments)
          .where(
            and(
              eq(questionnaireResponseComments.questionnaire_response_id, responseId),
              isNull(questionnaireResponseComments.deleted_at),
            ),
          )
          .orderBy(questionnaireResponseComments.created_at),
        loadUserPropertiesForRows(app.db, [row]),
      ]);

      return {
        ...serializeResponse(
          row,
          parent?.name,
          parent?.slug,
          appRow?.name,
          row.user_id ? userPropsMap.get(`${row.project_id}:${row.user_id}`) ?? null : null,
        ),
        comments: commentRows.map(serializeResponseComment),
      };
    },
  );

  app.patch<{
    Params: { projectId: string; questionnaireId: string; responseId: string };
    Body: UpdateQuestionnaireResponseRequest;
  }>(
    "/questionnaires/:questionnaireId/responses/:responseId",
    { preHandler: requirePermission("questionnaires:write") },
    async (request, reply) => {
      const { projectId, questionnaireId, responseId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { status } = request.body ?? {};
      if (!status) return reply.code(400).send({ error: "status is required" });
      if (!QUESTIONNAIRE_RESPONSE_STATUSES.includes(status)) {
        return reply.code(400).send({
          error: `Invalid status. Must be one of: ${QUESTIONNAIRE_RESPONSE_STATUSES.join(", ")}`,
        });
      }

      const [updated] = await app.db
        .update(questionnaireResponses)
        .set({ status })
        .where(
          and(
            eq(questionnaireResponses.id, responseId),
            eq(questionnaireResponses.questionnaire_id, questionnaireId),
            eq(questionnaireResponses.project_id, projectId),
            isNull(questionnaireResponses.deleted_at),
          ),
        )
        .returning();
      if (!updated) return reply.code(404).send({ error: "Response not found" });

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "questionnaire_response",
        resource_id: responseId,
        changes: { status: { after: status } },
      });

      return serializeResponse(updated);
    },
  );

  app.delete<{ Params: { projectId: string; questionnaireId: string; responseId: string } }>(
    "/questionnaires/:questionnaireId/responses/:responseId",
    { preHandler: requirePermission("questionnaires:write") },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete responses" });
      }
      const { projectId, questionnaireId, responseId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const deleted = await app.db
        .update(questionnaireResponses)
        .set({ deleted_at: new Date() })
        .where(
          and(
            eq(questionnaireResponses.id, responseId),
            eq(questionnaireResponses.questionnaire_id, questionnaireId),
            eq(questionnaireResponses.project_id, projectId),
            isNull(questionnaireResponses.deleted_at),
          ),
        )
        .returning({ id: questionnaireResponses.id });
      if (deleted.length === 0) return reply.code(404).send({ error: "Response not found" });

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "delete",
        resource_type: "questionnaire_response",
        resource_id: responseId,
      });

      return { deleted: true };
    },
  );

  // --- Comments ---

  app.post<{
    Params: { projectId: string; questionnaireId: string; responseId: string };
    Body: CreateQuestionnaireResponseCommentRequest;
  }>(
    "/questionnaires/:questionnaireId/responses/:responseId/comments",
    { preHandler: requirePermission("questionnaires:write") },
    async (request, reply) => {
      const { projectId, questionnaireId, responseId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { body } = request.body ?? { body: "" };
      if (!body || !body.trim()) return reply.code(400).send({ error: "body is required" });

      const [[row], author] = await Promise.all([
        app.db
          .select({ id: questionnaireResponses.id })
          .from(questionnaireResponses)
          .where(
            and(
              eq(questionnaireResponses.id, responseId),
              eq(questionnaireResponses.questionnaire_id, questionnaireId),
              eq(questionnaireResponses.project_id, projectId),
              isNull(questionnaireResponses.deleted_at),
            ),
          )
          .limit(1),
        resolveCommentAuthor(app.db, request.auth),
      ]);
      if (!row) return reply.code(404).send({ error: "Response not found" });

      const [created] = await app.db
        .insert(questionnaireResponseComments)
        .values({
          questionnaire_response_id: responseId,
          author_type: author.authorType,
          author_id: author.authorId,
          author_name: author.authorName,
          body: body.trim(),
        })
        .returning();
      return reply.code(201).send(serializeResponseComment(created));
    },
  );

  app.patch<{
    Params: { projectId: string; questionnaireId: string; responseId: string; commentId: string };
    Body: UpdateQuestionnaireResponseCommentRequest;
  }>(
    "/questionnaires/:questionnaireId/responses/:responseId/comments/:commentId",
    { preHandler: requirePermission("questionnaires:write") },
    async (request, reply) => {
      const { projectId, responseId, commentId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;
      const { body } = request.body ?? { body: "" };
      if (!body || !body.trim()) return reply.code(400).send({ error: "body is required" });

      const [comment] = await app.db
        .select()
        .from(questionnaireResponseComments)
        .where(
          and(
            eq(questionnaireResponseComments.id, commentId),
            eq(questionnaireResponseComments.questionnaire_response_id, responseId),
            isNull(questionnaireResponseComments.deleted_at),
          ),
        )
        .limit(1);
      if (!comment) return reply.code(404).send({ error: "Comment not found" });

      const auth = request.auth;
      const actorId = auth.type === "user" ? auth.user_id : auth.key_id;
      if (comment.author_id !== actorId) {
        return reply.code(403).send({ error: "Only the original author can edit this comment" });
      }

      const [updated] = await app.db
        .update(questionnaireResponseComments)
        .set({ body: body.trim() })
        .where(eq(questionnaireResponseComments.id, commentId))
        .returning();
      return serializeResponseComment(updated);
    },
  );

  app.delete<{
    Params: { projectId: string; questionnaireId: string; responseId: string; commentId: string };
  }>(
    "/questionnaires/:questionnaireId/responses/:responseId/comments/:commentId",
    { preHandler: requirePermission("questionnaires:write") },
    async (request, reply) => {
      const { projectId, responseId, commentId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;
      const [comment] = await app.db
        .select()
        .from(questionnaireResponseComments)
        .where(
          and(
            eq(questionnaireResponseComments.id, commentId),
            eq(questionnaireResponseComments.questionnaire_response_id, responseId),
            isNull(questionnaireResponseComments.deleted_at),
          ),
        )
        .limit(1);
      if (!comment) return reply.code(404).send({ error: "Comment not found" });

      const auth = request.auth;
      const actorId = auth.type === "user" ? auth.user_id : auth.key_id;
      if (comment.author_id !== actorId) {
        if (auth.type !== "user") {
          return reply.code(403).send({ error: "Only the original author or a team admin can delete this comment" });
        }
        const membership = auth.team_memberships?.find((t) => t.team_id === project.team_id);
        if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
          return reply.code(403).send({ error: "Only the original author or a team admin can delete this comment" });
        }
      }
      await app.db
        .update(questionnaireResponseComments)
        .set({ deleted_at: new Date() })
        .where(eq(questionnaireResponseComments.id, commentId));
      return { deleted: true };
    },
  );

  // --- Analytics ---

  app.get<{
    Params: { projectId: string; questionnaireId: string };
    Querystring: { is_dev?: string; data_mode?: string; submitted_only?: string };
  }>(
    "/questionnaires/:questionnaireId/analytics",
    { preHandler: requirePermission("questionnaires:read") },
    async (request, reply) => {
      const { projectId, questionnaireId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [parent] = await app.db
        .select()
        .from(questionnaires)
        .where(
          and(
            eq(questionnaires.id, questionnaireId),
            eq(questionnaires.project_id, projectId),
            isNull(questionnaires.deleted_at),
          ),
        )
        .limit(1);
      if (!parent) return reply.code(404).send({ error: "Questionnaire not found" });

      const { is_dev, data_mode, submitted_only } = request.query;
      const filters = [
        eq(questionnaireResponses.questionnaire_id, questionnaireId),
        isNull(questionnaireResponses.deleted_at),
      ];
      if (is_dev !== undefined) {
        filters.push(eq(questionnaireResponses.is_dev, is_dev === "true"));
      } else {
        const devCondition = dataModeToDrizzle(questionnaireResponses.is_dev, data_mode as DataMode);
        if (devCondition) filters.push(devCondition);
      }
      // Drafts contribute to the per-question rollups by default (the JSONB ?
      // operator naturally lands a Q1-only answer in Q1's count and skips
      // Q2+). submitted_only=true filters them out for callers who want
      // completed-only stats.
      if (submitted_only === "true") {
        filters.push(sql`${questionnaireResponses.submitted_at} IS NOT NULL`);
      }

      const schema = parent.schema as QuestionnaireSchema;
      // Counts + per-question rollups are independent SELECTs against the
      // same filter set; fan them out in parallel. The counts query uses a
      // single `COUNT(*) FILTER` so total + submitted come back in one
      // round-trip (matches the loadResponseCountsByQuestionnaire pattern).
      // `submitted` is surfaced unconditionally so dashboards can render
      // "N total · M completed" even when drafts are included; when
      // submitted_only=true is in effect, it matches total.
      const [[counts = { total: 0, submitted: 0 }], analytics] = await Promise.all([
        app.db
          .select({
            total: countAll,
            submitted: sql<number>`COUNT(*) FILTER (WHERE ${questionnaireResponses.submitted_at} IS NOT NULL)`,
          })
          .from(questionnaireResponses)
          .where(and(...filters)),
        Promise.all(schema.questions.map((q) => analyzeQuestion(app, q, filters))),
      ]);

      const response: QuestionnaireAnalyticsResponse = {
        questionnaire_id: parent.id,
        slug: parent.slug,
        total_responses: Number(counts.total),
        submitted_count: Number(counts.submitted),
        questions: analytics,
      };
      return response;
    },
  );
}

function trimOptional(
  value: string | null | undefined,
  max: number,
): string | null | undefined {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

async function analyzeQuestion(
  app: FastifyInstance,
  question: QuestionnaireSchema["questions"][number],
  filters: ReturnType<typeof eq>[],
): Promise<QuestionnaireQuestionAnalytics> {
  const path = question.id;

  switch (question.type) {
    case "text": {
      const totalRow = await app.db
        .select({ count: countAll })
        .from(questionnaireResponses)
        .where(and(...filters, sql`${questionnaireResponses.answers} ? ${path}`));
      const total = Number(totalRow[0]?.count ?? 0);

      const recent = await app.db
        .select({
          id: questionnaireResponses.id,
          answer: sql<string>`${questionnaireResponses.answers}->>${path}`,
          created_at: questionnaireResponses.created_at,
        })
        .from(questionnaireResponses)
        .where(and(...filters, sql`${questionnaireResponses.answers} ? ${path}`))
        .orderBy(desc(questionnaireResponses.created_at))
        .limit(10);

      return {
        id: question.id,
        type: "text",
        total_answered: total,
        recent_answers: recent.map((r) => ({
          response_id: r.id,
          answer: r.answer,
          created_at: r.created_at.toISOString(),
        })),
      };
    }
    case "single_choice": {
      // GROUP BY 1 (positional) avoids parameterized-expression mismatch
      // between SELECT and GROUP BY when path is bound twice.
      const rows = await app.db.execute<{ choice: string; count: number }>(sql`
        SELECT ${questionnaireResponses.answers}->>${path} AS choice,
               COUNT(*)::int AS count
        FROM ${questionnaireResponses}
        WHERE ${and(...filters, sql`${questionnaireResponses.answers} ? ${path}`)}
        GROUP BY 1
      `);
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.choice, Number(r.count));
      const choices: QuestionnaireChoiceCount[] = question.options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        count: counts.get(opt.id) ?? 0,
      }));
      return {
        id: question.id,
        type: "single_choice",
        total_answered: choices.reduce((s, c) => s + c.count, 0),
        choices,
      };
    }
    case "multi_choice": {
      const rows = await app.db.execute<{ choice: string; count: number }>(sql`
        SELECT v::text AS choice, COUNT(*)::int AS count
        FROM ${questionnaireResponses},
             jsonb_array_elements_text(${questionnaireResponses.answers}->${path}) v
        WHERE ${and(...filters)}
        GROUP BY 1
      `);
      const map = new Map<string, number>();
      for (const r of rows) {
        map.set(r.choice, Number(r.count));
      }
      const totalAnsweredRow = await app.db
        .select({ count: countAll })
        .from(questionnaireResponses)
        .where(and(...filters, sql`${questionnaireResponses.answers} ? ${path}`));
      const choices: QuestionnaireChoiceCount[] = question.options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        count: map.get(opt.id) ?? 0,
      }));
      return {
        id: question.id,
        type: "multi_choice",
        total_answered: Number(totalAnsweredRow[0]?.count ?? 0),
        choices,
      };
    }
    case "rating": {
      const rows = await app.db.execute<{ value: number; count: number }>(sql`
        SELECT (${questionnaireResponses.answers}->>${path})::int AS value,
               COUNT(*)::int AS count
        FROM ${questionnaireResponses}
        WHERE ${and(...filters, sql`${questionnaireResponses.answers} ? ${path}`)}
        GROUP BY 1
      `);
      const byValue = new Map<number, number>();
      for (const r of rows) byValue.set(Number(r.value), Number(r.count));
      const buckets: QuestionnaireRatingBucket[] = [];
      for (let v = 1; v <= question.scale; v++) {
        buckets.push({ value: v, count: byValue.get(v) ?? 0 });
      }
      const totalAnswered = buckets.reduce((s, b) => s + b.count, 0);
      const sum = buckets.reduce((s, b) => s + b.value * b.count, 0);
      const average = totalAnswered > 0 ? Math.round((sum / totalAnswered) * 100) / 100 : null;
      return {
        id: question.id,
        type: "rating",
        total_answered: totalAnswered,
        average,
        buckets,
      };
    }
    case "nps": {
      const rows = await app.db.execute<{ value: number; count: number }>(sql`
        SELECT (${questionnaireResponses.answers}->>${path})::int AS value,
               COUNT(*)::int AS count
        FROM ${questionnaireResponses}
        WHERE ${and(...filters, sql`${questionnaireResponses.answers} ? ${path}`)}
        GROUP BY 1
      `);
      const byValue = new Map<number, number>();
      for (const r of rows) byValue.set(Number(r.value), Number(r.count));
      const buckets: QuestionnaireRatingBucket[] = [];
      for (let v = 0; v <= 10; v++) {
        buckets.push({ value: v, count: byValue.get(v) ?? 0 });
      }
      const totalAnswered = buckets.reduce((s, b) => s + b.count, 0);
      let detractors = 0;
      let passives = 0;
      let promoters = 0;
      for (const b of buckets) {
        if (b.value <= 6) detractors += b.count;
        else if (b.value <= 8) passives += b.count;
        else promoters += b.count;
      }
      const score =
        totalAnswered > 0
          ? Math.round(((promoters - detractors) / totalAnswered) * 100)
          : null;
      return {
        id: question.id,
        type: "nps",
        total_answered: totalAnswered,
        score,
        detractors,
        passives,
        promoters,
        buckets,
      };
    }
  }
}

export async function teamQuestionnaireRoutes(app: FastifyInstance) {
  // GET /v1/questionnaires/count — responses across accessible projects
  // (for dashboard stat cards). Counts both drafts and submitted rows.
  // Query params:
  //   since      — ISO timestamp or relative shorthand (e.g. "24h"); filters
  //                by created_at.
  //   data_mode  — "production" | "development" | "all". Defaults to "all" to
  //                match the rest of the questionnaire surface.
  app.get<{ Querystring: { since?: string; data_mode?: DataMode } }>(
    "/questionnaires/count",
    { preHandler: requirePermission("questionnaires:read") },
    async (request, reply) => {
      const teamIds = getAuthTeamIds(request.auth);
      if (teamIds.length === 0) return { count: 0 };
      const { since, data_mode } = request.query;
      const dataModeCondition = dataModeToDrizzle(
        questionnaireResponses.is_dev,
        data_mode ?? "all",
      );
      let sinceDate: Date | undefined;
      if (since) {
        try {
          sinceDate = parseTimeParam(since);
        } catch {
          return reply.code(400).send({ error: "Invalid `since` parameter" });
        }
      }
      const [{ total } = { total: 0 }] = await app.db
        .select({ total: countAll })
        .from(questionnaireResponses)
        .innerJoin(apps, eq(apps.id, questionnaireResponses.app_id))
        .where(
          and(
            isNull(questionnaireResponses.deleted_at),
            inArray(apps.team_id, teamIds),
            ...(dataModeCondition ? [dataModeCondition] : []),
            ...(sinceDate
              ? [gte(questionnaireResponses.created_at, sinceDate)]
              : []),
          ),
        );
      return { count: Number(total) };
    },
  );

  // GET /v1/questionnaires?team_id=… — list every questionnaire across
  // accessible projects in the team. Powers the dashboard's "all projects"
  // view (mirrors the team-scoped /v1/feedback and /v1/ads/campaigns routes).
  // No pagination cursor — questionnaires is low volume; capped by LIMIT.
  app.get<{ Querystring: QuestionnaireQueryParams }>(
    "/questionnaires",
    { preHandler: requirePermission("questionnaires:read") },
    async (request) => {
      const allTeamIds = getAuthTeamIds(request.auth);
      const { team_id, project_id, app_id, is_active, data_mode, limit: rawLimit } = request.query;

      const teamIds = team_id
        ? allTeamIds.includes(team_id)
          ? [team_id]
          : []
        : allTeamIds;

      if (teamIds.length === 0) {
        return { questionnaires: [] };
      }

      const projectConditions = [inArray(projects.team_id, teamIds), isNull(projects.deleted_at)];
      if (project_id) projectConditions.push(eq(projects.id, project_id));
      const accessibleProjects = await app.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(...projectConditions));

      if (accessibleProjects.length === 0) {
        return { questionnaires: [] };
      }

      const projectIds = accessibleProjects.map((p) => p.id);
      const conditions = [
        inArray(questionnaires.project_id, projectIds),
        isNull(questionnaires.deleted_at),
      ];
      if (app_id) conditions.push(eq(questionnaires.app_id, app_id));
      if (is_active !== undefined) {
        conditions.push(eq(questionnaires.is_active, is_active === "true"));
      }

      const limit = Math.min(Math.max(Number(rawLimit) || 500, 1), 500);
      const rows = await app.db
        .select()
        .from(questionnaires)
        .where(and(...conditions))
        .orderBy(desc(questionnaires.created_at), desc(questionnaires.id))
        .limit(limit);

      const countsById = await loadResponseCountsByQuestionnaire(
        app.db,
        rows.map((r) => r.id),
        data_mode as DataMode | undefined,
      );

      return {
        questionnaires: rows.map((r) => {
          const counts = countsById.get(r.id);
          return serializeQuestionnaire(
            r,
            counts?.count ?? 0,
            counts?.last ?? null,
            counts?.submitted ?? 0,
          );
        }),
      };
    },
  );
}
