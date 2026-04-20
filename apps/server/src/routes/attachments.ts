import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { apps, eventAttachments, issues, projects } from "@owlmetry/db";
import { ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS } from "@owlmetry/shared";
import type {
  AttachmentDownloadUrlResponse,
  AttachmentListResponse,
  AttachmentQuotaUsage,
  AttachmentSummary,
} from "@owlmetry/shared";
import {
  requirePermission,
  getAuthTeamIds,
  hasTeamAccess,
  assertTeamRole,
} from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { config } from "../config.js";
import { DiskFileStorage } from "../storage/file-storage.js";
import {
  buildSignedDownloadUrl,
  verifyAttachmentToken,
} from "../utils/attachment-signing.js";
import {
  getProjectAttachmentUsage,
  getProjectWithAttachmentLimits,
  resolveAttachmentLimits,
} from "../utils/attachment-quota.js";
import { normalizeLimit } from "../utils/pagination.js";

function toSummary(row: typeof eventAttachments.$inferSelect): AttachmentSummary {
  return {
    id: row.id,
    project_id: row.project_id,
    app_id: row.app_id,
    event_client_id: row.event_client_id,
    event_id: row.event_id,
    issue_id: row.issue_id,
    user_id: row.user_id,
    original_filename: row.original_filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    is_dev: row.is_dev,
    uploaded_at: row.uploaded_at ? row.uploaded_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

export async function attachmentsRoutes(app: FastifyInstance) {
  // Signed download — no auth, signature encodes authorization.
  app.get<{ Querystring: { t?: string } }>(
    "/attachments/download",
    async (request, reply) => {
      const token = request.query.t;
      if (!token) {
        return reply.code(401).send({ error: "Missing download token" });
      }
      const verified = verifyAttachmentToken(
        token,
        config.attachmentsSigningSecret
      );
      if (!verified) {
        return reply.code(401).send({ error: "Invalid or expired download token" });
      }

      const [row] = await app.db
        .select()
        .from(eventAttachments)
        .where(eq(eventAttachments.id, verified.attachmentId))
        .limit(1);
      if (!row || row.deleted_at || !row.uploaded_at) {
        return reply.code(404).send({ error: "Attachment not found" });
      }

      reply.header("Content-Type", row.content_type);
      reply.header("Content-Length", String(row.size_bytes));
      reply.header(
        "Content-Disposition",
        `attachment; filename="${row.original_filename.replace(/"/g, "")}"`
      );
      reply.header("X-Content-Type-Options", "nosniff");

      // Prefer nginx X-Accel-Redirect when configured so Node never holds the bytes.
      if (config.attachmentsInternalUri) {
        const storage = new DiskFileStorage(config.attachmentsPath);
        try {
          const internalUri = storage.toInternalUri(
            row.storage_path,
            config.attachmentsInternalUri,
            config.attachmentsPath
          );
          reply.header("X-Accel-Redirect", internalUri);
          return reply.send();
        } catch (err) {
          request.log.error(
            { err, attachmentId: row.id },
            "failed to compute X-Accel-Redirect URI, falling back to stream"
          );
        }
      }

      const storage = new DiskFileStorage(config.attachmentsPath);
      try {
        const { stream } = await storage.get(row.storage_path);
        return reply.send(stream);
      } catch (err) {
        request.log.error({ err, attachmentId: row.id }, "attachment read failed");
        return reply.code(500).send({ error: "Failed to read attachment" });
      }
    }
  );

  // List attachments — agent keys or users. Filter by event, issue, or project.
  app.get<{
    Querystring: {
      event_id?: string;
      event_client_id?: string;
      issue_id?: string;
      project_id?: string;
      cursor?: string;
      limit?: string;
    };
  }>(
    "/attachments",
    { preHandler: [requirePermission("events:read"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      if (allTeamIds.length === 0) {
        return { attachments: [], cursor: null, has_more: false } satisfies AttachmentListResponse;
      }

      const { event_id, event_client_id, issue_id, project_id, cursor, limit: rawLimit } =
        request.query;
      const limit = normalizeLimit(rawLimit);

      const conditions = [isNull(eventAttachments.deleted_at)];

      if (project_id) {
        const [projectRow] = await app.db
          .select({ team_id: projects.team_id })
          .from(projects)
          .where(eq(projects.id, project_id))
          .limit(1);
        if (!projectRow || !allTeamIds.includes(projectRow.team_id)) {
          return { attachments: [], cursor: null, has_more: false } satisfies AttachmentListResponse;
        }
        conditions.push(eq(eventAttachments.project_id, project_id));
      } else {
        // Scope to projects in the user's teams.
        const teamProjects = await app.db
          .select({ id: projects.id })
          .from(projects)
          .where(inArray(projects.team_id, allTeamIds));
        const ids = teamProjects.map((p) => p.id);
        if (ids.length === 0) {
          return { attachments: [], cursor: null, has_more: false } satisfies AttachmentListResponse;
        }
        conditions.push(inArray(eventAttachments.project_id, ids));
      }

      if (event_id) conditions.push(eq(eventAttachments.event_id, event_id));
      if (event_client_id) conditions.push(eq(eventAttachments.event_client_id, event_client_id));
      if (issue_id) conditions.push(eq(eventAttachments.issue_id, issue_id));
      if (cursor) conditions.push(lt(eventAttachments.created_at, new Date(cursor)));

      const rows = await app.db
        .select()
        .from(eventAttachments)
        .where(and(...conditions))
        .orderBy(desc(eventAttachments.created_at))
        .limit(limit + 1);

      const has_more = rows.length > limit;
      const page = has_more ? rows.slice(0, limit) : rows;
      const response: AttachmentListResponse = {
        attachments: page.map(toSummary),
        cursor: has_more ? page[page.length - 1].created_at.toISOString() : null,
        has_more,
      };
      return response;
    }
  );

  // Get one attachment — metadata + short-lived download URL.
  app.get<{ Params: { id: string } }>(
    "/attachments/:id",
    { preHandler: [requirePermission("events:read")] },
    async (request, reply) => {
      const auth = request.auth;
      const [row] = await app.db
        .select()
        .from(eventAttachments)
        .where(eq(eventAttachments.id, request.params.id))
        .limit(1);
      if (!row || row.deleted_at) {
        return reply.code(404).send({ error: "Attachment not found" });
      }
      const [projectRow] = await app.db
        .select({ team_id: projects.team_id })
        .from(projects)
        .where(eq(projects.id, row.project_id))
        .limit(1);
      if (!projectRow || !hasTeamAccess(auth, projectRow.team_id)) {
        return reply.code(404).send({ error: "Attachment not found" });
      }

      const download = row.uploaded_at
        ? buildSignedDownloadUrl(
            config.publicUrl,
            row.id,
            ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS,
            config.attachmentsSigningSecret
          )
        : null;

      const summary = toSummary(row);
      if (!download) return summary;
      const withDownload: AttachmentSummary & { download_url: AttachmentDownloadUrlResponse } = {
        ...summary,
        download_url: {
          url: download.url,
          expires_at: new Date(download.expiresUnix * 1000).toISOString(),
          original_filename: row.original_filename,
          content_type: row.content_type,
          size_bytes: row.size_bytes,
        },
      };
      return withDownload;
    }
  );

  // Delete an attachment — soft delete. Hard delete + file removal happens in cleanup job.
  app.delete<{ Params: { id: string } }>(
    "/attachments/:id",
    { preHandler: [requirePermission("events:write")] },
    async (request, reply) => {
      const auth = request.auth;
      const [row] = await app.db
        .select()
        .from(eventAttachments)
        .where(eq(eventAttachments.id, request.params.id))
        .limit(1);
      if (!row || row.deleted_at) {
        return reply.code(404).send({ error: "Attachment not found" });
      }
      const [projectRow] = await app.db
        .select({ team_id: projects.team_id })
        .from(projects)
        .where(eq(projects.id, row.project_id))
        .limit(1);
      if (!projectRow || !hasTeamAccess(auth, projectRow.team_id)) {
        return reply.code(404).send({ error: "Attachment not found" });
      }
      const roleErr = assertTeamRole(auth, projectRow.team_id, "member");
      if (roleErr) return reply.code(403).send({ error: roleErr });

      await app.db
        .update(eventAttachments)
        .set({ deleted_at: new Date() })
        .where(eq(eventAttachments.id, row.id));
      return { ok: true };
    }
  );

  // Per-project usage.
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/attachment-usage",
    { preHandler: [requirePermission("events:read")] },
    async (request, reply) => {
      const auth = request.auth;
      const { projectId } = request.params;
      const project = await getProjectWithAttachmentLimits(app.db, projectId);
      if (!project || project.deleted_at) {
        return reply.code(404).send({ error: "Project not found" });
      }
      if (!hasTeamAccess(auth, project.team_id)) {
        return reply.code(404).send({ error: "Project not found" });
      }
      const limits = resolveAttachmentLimits(project);
      const usage = await getProjectAttachmentUsage(app.db, projectId);
      const response: AttachmentQuotaUsage = {
        project_id: projectId,
        used_bytes: usage.usedBytes,
        quota_bytes: limits.projectQuotaBytes,
        max_file_bytes: limits.maxFileBytes,
        file_count: usage.fileCount,
      };
      return response;
    }
  );
}
