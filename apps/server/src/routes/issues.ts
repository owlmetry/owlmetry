import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, sql, desc } from "drizzle-orm";
import { issues, issueFingerprints, issueOccurrences, issueComments, apps, projects, eventAttachments, appUsers } from "@owlmetry/db";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, ISSUE_STATUSES, ATTACHMENT_ISSUE_DETAIL_PAGE_SIZE } from "@owlmetry/shared";
import type { IssueStatus, IssuesQueryParams, UpdateIssueRequest, MergeIssuesRequest, CreateIssueCommentRequest, UpdateIssueCommentRequest } from "@owlmetry/shared";
import type { IssueAlertFrequency } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { resolveProject } from "../utils/project.js";
import { dataModeToDrizzle } from "../utils/data-mode.js";
import { normalizeLimit, encodeKeysetCursor, decodeKeysetCursor } from "../utils/pagination.js";
import { resolveCommentAuthor } from "../utils/comment-author.js";

function serializeIssue(
  row: typeof issues.$inferSelect,
  fingerprints: string[],
  appName?: string,
  projectName?: string,
) {
  return {
    id: row.id,
    app_id: row.app_id,
    project_id: row.project_id,
    status: row.status,
    title: row.title,
    source_module: row.source_module,
    is_dev: row.is_dev,
    occurrence_count: row.occurrence_count,
    unique_user_count: row.unique_user_count,
    resolved_at_version: row.resolved_at_version,
    first_seen_app_version: row.first_seen_app_version,
    last_seen_app_version: row.last_seen_app_version,
    first_seen_at: row.first_seen_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
    last_notified_at: row.last_notified_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    fingerprints,
    ...(appName !== undefined ? { app_name: appName } : {}),
    ...(projectName !== undefined ? { project_name: projectName } : {}),
  };
}

function serializeOccurrence(
  row: typeof issueOccurrences.$inferSelect,
  appUserIdMap?: Map<string, string>,
) {
  return {
    id: row.id,
    issue_id: row.issue_id,
    session_id: row.session_id,
    user_id: row.user_id,
    app_user_id: row.user_id ? appUserIdMap?.get(row.user_id) ?? null : null,
    app_version: row.app_version,
    environment: row.environment,
    event_id: row.event_id,
    country_code: row.country_code,
    timestamp: row.timestamp.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

function serializeComment(row: typeof issueComments.$inferSelect) {
  return {
    id: row.id,
    issue_id: row.issue_id,
    author_type: row.author_type,
    author_id: row.author_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// Valid status transitions (job-only transitions like resolved→regressed are not exposed via API)
const VALID_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  new: ["in_progress", "resolved", "silenced"],
  in_progress: ["new", "resolved", "silenced"],
  resolved: ["new", "silenced"],
  regressed: ["in_progress", "resolved", "silenced"],
  silenced: ["new", "in_progress", "resolved"],
};

/** Routes nested under /v1/projects/:projectId */
export async function issuesRoutes(app: FastifyInstance) {
  // List issues for a project
  app.get<{ Params: { projectId: string }; Querystring: IssuesQueryParams }>(
    "/issues",
    { preHandler: requirePermission("issues:read") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { status, app_id, is_dev, cursor, limit: limitStr } = request.query;
      const limit = Math.min(Math.max(parseInt(limitStr || "", 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

      // Build conditions
      const conditions = [eq(issues.project_id, projectId)];
      if (status && ISSUE_STATUSES.includes(status as IssueStatus)) {
        conditions.push(eq(issues.status, status as IssueStatus));
      }
      if (app_id) {
        conditions.push(eq(issues.app_id, app_id));
      }
      if (is_dev !== undefined) {
        conditions.push(eq(issues.is_dev, is_dev === "true"));
      }

      if (cursor) {
        const decoded = decodeKeysetCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${issues.last_seen_at} < ${decoded.timestamp}::timestamptz OR (${issues.last_seen_at} = ${decoded.timestamp}::timestamptz AND ${issues.id} < ${decoded.id}))`,
          );
        } else {
          // Fallback for legacy plain-UUID cursors
          conditions.push(sql`${issues.id} < ${cursor}`);
        }
      }

      const rows = await app.db
        .select()
        .from(issues)
        .where(and(...conditions))
        .orderBy(desc(issues.last_seen_at), desc(issues.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      // Fetch fingerprints for all issues in one query
      const issueIds = page.map((i) => i.id);
      const fpRows = issueIds.length > 0
        ? await app.db
            .select({ issue_id: issueFingerprints.issue_id, fingerprint: issueFingerprints.fingerprint })
            .from(issueFingerprints)
            .where(inArray(issueFingerprints.issue_id, issueIds))
        : [];
      const fpMap = new Map<string, string[]>();
      for (const fp of fpRows) {
        const list = fpMap.get(fp.issue_id) ?? [];
        list.push(fp.fingerprint);
        fpMap.set(fp.issue_id, list);
      }

      // Fetch app names
      const appIds = [...new Set(page.map((i) => i.app_id))];
      const appRows = appIds.length > 0
        ? await app.db.select({ id: apps.id, name: apps.name }).from(apps).where(inArray(apps.id, appIds))
        : [];
      const appNameMap = new Map(appRows.map((a) => [a.id, a.name]));

      const lastItem = page[page.length - 1];
      return {
        issues: page.map((i) => serializeIssue(i, fpMap.get(i.id) ?? [], appNameMap.get(i.app_id))),
        cursor: hasMore && lastItem ? encodeKeysetCursor(lastItem.last_seen_at, lastItem.id) : null,
        has_more: hasMore,
      };
    }
  );

  // Get issue detail
  app.get<{ Params: { projectId: string; issueId: string }; Querystring: { occurrence_cursor?: string; occurrence_limit?: string } }>(
    "/issues/:issueId",
    { preHandler: requirePermission("issues:read") },
    async (request, reply) => {
      const { projectId, issueId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [issue] = await app.db
        .select()
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.project_id, projectId)))
        .limit(1);

      if (!issue) {
        return reply.code(404).send({ error: "Issue not found" });
      }

      const { occurrence_cursor, occurrence_limit: occLimitStr } = request.query;
      const occLimit = Math.min(Math.max(parseInt(occLimitStr || "", 10) || 50, 1), 200);

      const occConditions = [eq(issueOccurrences.issue_id, issueId)];
      if (occurrence_cursor) {
        occConditions.push(sql`${issueOccurrences.id} < ${occurrence_cursor}`);
      }

      // Run independent queries in parallel
      const [fps, [appRow], occRows, commentRows, attachmentRows] = await Promise.all([
        app.db
          .select({ fingerprint: issueFingerprints.fingerprint })
          .from(issueFingerprints)
          .where(eq(issueFingerprints.issue_id, issueId)),
        app.db.select({ name: apps.name }).from(apps).where(eq(apps.id, issue.app_id)).limit(1),
        app.db
          .select()
          .from(issueOccurrences)
          .where(and(...occConditions))
          .orderBy(desc(issueOccurrences.timestamp), desc(issueOccurrences.id))
          .limit(occLimit + 1),
        app.db
          .select()
          .from(issueComments)
          .where(and(eq(issueComments.issue_id, issueId), isNull(issueComments.deleted_at)))
          .orderBy(issueComments.created_at),
        app.db
          .select({
            id: eventAttachments.id,
            event_id: eventAttachments.event_id,
            original_filename: eventAttachments.original_filename,
            content_type: eventAttachments.content_type,
            size_bytes: eventAttachments.size_bytes,
            uploaded_at: eventAttachments.uploaded_at,
            created_at: eventAttachments.created_at,
          })
          .from(eventAttachments)
          .where(
            and(
              eq(eventAttachments.issue_id, issueId),
              isNull(eventAttachments.deleted_at)
            )
          )
          .orderBy(desc(eventAttachments.created_at))
          .limit(ATTACHMENT_ISSUE_DETAIL_PAGE_SIZE),
      ]);

      const occHasMore = occRows.length > occLimit;
      const occPage = occHasMore ? occRows.slice(0, occLimit) : occRows;

      // Resolve SDK user_id strings to app_user row UUIDs so the dashboard can deep-link to the user sheet
      const occUserIds = [...new Set(occPage.map((o) => o.user_id).filter((u): u is string => !!u))];
      const appUserRows = occUserIds.length > 0
        ? await app.db
            .select({ id: appUsers.id, user_id: appUsers.user_id })
            .from(appUsers)
            .where(and(eq(appUsers.project_id, projectId), inArray(appUsers.user_id, occUserIds)))
        : [];
      const appUserIdMap = new Map(appUserRows.map((u) => [u.user_id, u.id]));

      return {
        ...serializeIssue(issue, fps.map((f) => f.fingerprint), appRow?.name),
        occurrences: occPage.map((o) => serializeOccurrence(o, appUserIdMap)),
        occurrence_cursor: occHasMore ? occPage[occPage.length - 1].id : null,
        occurrence_has_more: occHasMore,
        comments: commentRows.map(serializeComment),
        attachments: attachmentRows.map((a) => ({
          id: a.id,
          event_id: a.event_id,
          original_filename: a.original_filename,
          content_type: a.content_type,
          size_bytes: a.size_bytes,
          uploaded_at: a.uploaded_at ? a.uploaded_at.toISOString() : null,
          created_at: a.created_at.toISOString(),
        })),
      };
    }
  );

  // Update issue status
  app.patch<{ Params: { projectId: string; issueId: string }; Body: UpdateIssueRequest }>(
    "/issues/:issueId",
    { preHandler: requirePermission("issues:write") },
    async (request, reply) => {
      const { projectId, issueId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { status, resolved_at_version } = request.body;

      if (!status) {
        return reply.code(400).send({ error: "status is required" });
      }

      if (!ISSUE_STATUSES.includes(status)) {
        return reply.code(400).send({ error: `Invalid status. Must be one of: ${ISSUE_STATUSES.join(", ")}` });
      }

      const [issue] = await app.db
        .select()
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.project_id, projectId)))
        .limit(1);

      if (!issue) {
        return reply.code(404).send({ error: "Issue not found" });
      }

      // Validate transition
      const allowed = VALID_TRANSITIONS[issue.status];
      if (!allowed || !allowed.includes(status)) {
        return reply.code(400).send({ error: `Cannot transition from '${issue.status}' to '${status}'` });
      }

      const setFields: Record<string, unknown> = { status };
      const changes: Record<string, { before: unknown; after: unknown }> = {
        status: { before: issue.status, after: status },
      };

      if (status === "resolved") {
        setFields.resolved_at_version = resolved_at_version ?? null;
        changes.resolved_at_version = { before: issue.resolved_at_version, after: resolved_at_version ?? null };
      }

      if (status === "new" || status === "in_progress") {
        // Clear resolved version when reopening/claiming
        setFields.resolved_at_version = null;
      }

      const [updated] = await app.db
        .update(issues)
        .set(setFields)
        .where(eq(issues.id, issueId))
        .returning();

      // Fetch fingerprints
      const fps = await app.db
        .select({ fingerprint: issueFingerprints.fingerprint })
        .from(issueFingerprints)
        .where(eq(issueFingerprints.issue_id, issueId));

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "issue",
        resource_id: issueId,
        changes,
      });

      return serializeIssue(updated, fps.map((f) => f.fingerprint));
    }
  );

  // Merge issues
  app.post<{ Params: { projectId: string; issueId: string }; Body: MergeIssuesRequest }>(
    "/issues/:issueId/merge",
    { preHandler: requirePermission("issues:write") },
    async (request, reply) => {
      const { projectId, issueId: targetId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { source_issue_id: sourceId } = request.body;

      if (!sourceId) {
        return reply.code(400).send({ error: "source_issue_id is required" });
      }

      if (sourceId === targetId) {
        return reply.code(400).send({ error: "Cannot merge an issue into itself" });
      }

      // Verify both exist in the same project
      const [target] = await app.db.select().from(issues).where(and(eq(issues.id, targetId), eq(issues.project_id, projectId))).limit(1);
      const [source] = await app.db.select().from(issues).where(and(eq(issues.id, sourceId), eq(issues.project_id, projectId))).limit(1);

      if (!target) return reply.code(404).send({ error: "Target issue not found" });
      if (!source) return reply.code(404).send({ error: "Source issue not found in this project" });

      // Move fingerprints from source to target
      await app.db
        .update(issueFingerprints)
        .set({ issue_id: targetId })
        .where(eq(issueFingerprints.issue_id, sourceId));

      // Move occurrences (skip duplicates)
      await app.db.execute(
        sql`UPDATE issue_occurrences SET issue_id = ${targetId}
            WHERE issue_id = ${sourceId}
            AND session_id NOT IN (
              SELECT session_id FROM issue_occurrences WHERE issue_id = ${targetId}
            )`
      );

      // Move comments from source to target
      await app.db
        .update(issueComments)
        .set({ issue_id: targetId })
        .where(eq(issueComments.issue_id, sourceId));

      // Delete source (CASCADE cleans up any remaining orphan occurrences)
      await app.db.delete(issues).where(eq(issues.id, sourceId));

      // Recompute target counts
      const [counts] = await app.db
        .select({
          occ_count: sql<number>`COUNT(*)::int`,
          user_count: sql<number>`COUNT(DISTINCT ${issueOccurrences.user_id})::int`,
          min_ts: sql<Date>`MIN(${issueOccurrences.timestamp})`,
          max_ts: sql<Date>`MAX(${issueOccurrences.timestamp})`,
        })
        .from(issueOccurrences)
        .where(eq(issueOccurrences.issue_id, targetId));

      await app.db
        .update(issues)
        .set({
          occurrence_count: counts?.occ_count ?? 0,
          unique_user_count: counts?.user_count ?? 0,
          first_seen_at: counts?.min_ts ? new Date(counts.min_ts as unknown as string) : target.first_seen_at,
          last_seen_at: counts?.max_ts ? new Date(counts.max_ts as unknown as string) : target.last_seen_at,
        })
        .where(eq(issues.id, targetId));

      // Fetch updated target
      const [updated] = await app.db.select().from(issues).where(eq(issues.id, targetId)).limit(1);
      const fps = await app.db
        .select({ fingerprint: issueFingerprints.fingerprint })
        .from(issueFingerprints)
        .where(eq(issueFingerprints.issue_id, targetId));

      logAuditEvent(app.db, request.auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "issue",
        resource_id: targetId,
        metadata: { merged_from: sourceId },
      });

      return serializeIssue(updated, fps.map((f) => f.fingerprint));
    }
  );

  // List comments for an issue
  app.get<{ Params: { projectId: string; issueId: string } }>(
    "/issues/:issueId/comments",
    { preHandler: requirePermission("issues:read") },
    async (request, reply) => {
      const { projectId, issueId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [issue] = await app.db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.project_id, projectId)))
        .limit(1);

      if (!issue) return reply.code(404).send({ error: "Issue not found" });

      const rows = await app.db
        .select()
        .from(issueComments)
        .where(and(eq(issueComments.issue_id, issueId), isNull(issueComments.deleted_at)))
        .orderBy(issueComments.created_at);

      return { comments: rows.map(serializeComment) };
    }
  );

  // Add comment to an issue
  app.post<{ Params: { projectId: string; issueId: string }; Body: CreateIssueCommentRequest }>(
    "/issues/:issueId/comments",
    { preHandler: requirePermission("issues:write") },
    async (request, reply) => {
      const { projectId, issueId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { body } = request.body;
      if (!body || !body.trim()) {
        return reply.code(400).send({ error: "body is required" });
      }

      const [issue] = await app.db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.project_id, projectId)))
        .limit(1);

      if (!issue) return reply.code(404).send({ error: "Issue not found" });

      const author = await resolveCommentAuthor(app.db, request.auth);

      const [created] = await app.db
        .insert(issueComments)
        .values({
          issue_id: issueId,
          author_type: author.authorType,
          author_id: author.authorId,
          author_name: author.authorName,
          body: body.trim(),
        })
        .returning();

      return reply.code(201).send(serializeComment(created));
    }
  );

  // Edit a comment
  app.patch<{ Params: { projectId: string; issueId: string; commentId: string }; Body: UpdateIssueCommentRequest }>(
    "/issues/:issueId/comments/:commentId",
    { preHandler: requirePermission("issues:write") },
    async (request, reply) => {
      const { projectId, issueId, commentId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const { body } = request.body;
      if (!body || !body.trim()) {
        return reply.code(400).send({ error: "body is required" });
      }

      const [comment] = await app.db
        .select()
        .from(issueComments)
        .where(
          and(
            eq(issueComments.id, commentId),
            eq(issueComments.issue_id, issueId),
            isNull(issueComments.deleted_at),
          )
        )
        .limit(1);

      if (!comment) return reply.code(404).send({ error: "Comment not found" });

      // Only original author can edit
      const auth = request.auth;
      const actorId = auth.type === "user" ? auth.user_id : auth.key_id;
      if (comment.author_id !== actorId) {
        return reply.code(403).send({ error: "Only the original author can edit this comment" });
      }

      const [updated] = await app.db
        .update(issueComments)
        .set({ body: body.trim() })
        .where(eq(issueComments.id, commentId))
        .returning();

      return serializeComment(updated);
    }
  );

  // Delete (soft-delete) a comment
  app.delete<{ Params: { projectId: string; issueId: string; commentId: string } }>(
    "/issues/:issueId/comments/:commentId",
    { preHandler: requirePermission("issues:write") },
    async (request, reply) => {
      const { projectId, issueId, commentId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [comment] = await app.db
        .select()
        .from(issueComments)
        .where(
          and(
            eq(issueComments.id, commentId),
            eq(issueComments.issue_id, issueId),
            isNull(issueComments.deleted_at),
          )
        )
        .limit(1);

      if (!comment) return reply.code(404).send({ error: "Comment not found" });

      // Original author or team admin/owner can delete
      const auth = request.auth;
      const actorId = auth.type === "user" ? auth.user_id : auth.key_id;
      if (comment.author_id !== actorId) {
        // Check if user has admin/owner role on the team
        if (auth.type !== "user") {
          return reply.code(403).send({ error: "Only the original author or a team admin can delete this comment" });
        }
        const membership = auth.team_memberships?.find((t) => t.team_id === project.team_id);
        if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
          return reply.code(403).send({ error: "Only the original author or a team admin can delete this comment" });
        }
      }

      await app.db
        .update(issueComments)
        .set({ deleted_at: new Date() })
        .where(eq(issueComments.id, commentId));

      return { deleted: true };
    }
  );
}

/** Team-level issues route at /v1/issues (mirrors events pattern) */
export async function teamIssuesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: IssuesQueryParams }>(
    "/issues",
    { preHandler: requirePermission("issues:read") },
    async (request) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);

      const { team_id, project_id, status, app_id, is_dev, data_mode, cursor, limit: rawLimit } = request.query;
      const limit = normalizeLimit(rawLimit);

      // Scope to requested team or all accessible teams
      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { issues: [], cursor: null, has_more: false };
      }

      // Find accessible project IDs
      const projectConditions = [inArray(projects.team_id, teamIds), isNull(projects.deleted_at)];
      if (project_id) {
        projectConditions.push(eq(projects.id, project_id));
      }
      const accessibleProjects = await app.db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(...projectConditions));

      if (accessibleProjects.length === 0) {
        return { issues: [], cursor: null, has_more: false };
      }

      const projectIds = accessibleProjects.map((p) => p.id);
      const projectNameMap = new Map(accessibleProjects.map((p) => [p.id, p.name]));

      // Build conditions
      const conditions = [inArray(issues.project_id, projectIds)];

      if (status && ISSUE_STATUSES.includes(status as IssueStatus)) {
        conditions.push(eq(issues.status, status as IssueStatus));
      }
      if (app_id) {
        conditions.push(eq(issues.app_id, app_id));
      }
      const devCondition = dataModeToDrizzle(issues.is_dev, data_mode as any);
      if (devCondition) conditions.push(devCondition);

      if (cursor) {
        const decoded = decodeKeysetCursor(cursor);
        if (decoded) {
          conditions.push(
            sql`(${issues.last_seen_at} < ${decoded.timestamp}::timestamptz OR (${issues.last_seen_at} = ${decoded.timestamp}::timestamptz AND ${issues.id} < ${decoded.id}))`,
          );
        } else {
          conditions.push(sql`${issues.id} < ${cursor}`);
        }
      }

      const rows = await app.db
        .select()
        .from(issues)
        .where(and(...conditions))
        .orderBy(desc(issues.last_seen_at), desc(issues.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      // Fetch fingerprints
      const issueIds = page.map((i) => i.id);
      const fpRows = issueIds.length > 0
        ? await app.db
            .select({ issue_id: issueFingerprints.issue_id, fingerprint: issueFingerprints.fingerprint })
            .from(issueFingerprints)
            .where(inArray(issueFingerprints.issue_id, issueIds))
        : [];
      const fpMap = new Map<string, string[]>();
      for (const fp of fpRows) {
        const list = fpMap.get(fp.issue_id) ?? [];
        list.push(fp.fingerprint);
        fpMap.set(fp.issue_id, list);
      }

      // Fetch app names
      const appIds = [...new Set(page.map((i) => i.app_id))];
      const appRows = appIds.length > 0
        ? await app.db.select({ id: apps.id, name: apps.name }).from(apps).where(inArray(apps.id, appIds))
        : [];
      const appNameMap = new Map(appRows.map((a) => [a.id, a.name]));

      const lastItem = page[page.length - 1];
      return {
        issues: page.map((i) => serializeIssue(i, fpMap.get(i.id) ?? [], appNameMap.get(i.app_id), projectNameMap.get(i.project_id))),
        cursor: hasMore && lastItem ? encodeKeysetCursor(lastItem.last_seen_at, lastItem.id) : null,
        has_more: hasMore,
      };
    }
  );
}
