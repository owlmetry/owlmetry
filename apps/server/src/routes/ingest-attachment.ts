import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { apps, eventAttachments, events } from "@owlmetry/db";
import {
  ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS,
  ATTACHMENT_MAX_FILENAME_LENGTH,
  ATTACHMENT_UPLOAD_URL_TTL_SECONDS,
  MAX_ATTACHMENT_USER_QUOTA_BYTES,
  isDisallowedAttachmentContentType,
} from "@owlmetry/shared";
import type {
  AttachmentRejection,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
} from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { attachmentStorage } from "../storage/index.js";
import { config } from "../config.js";
import { buildSignedDownloadUrl } from "../utils/attachment-signing.js";
import {
  getProjectAttachmentUsage,
  getProjectWithAttachmentLimits,
  getUserAttachmentUsage,
  resolveAttachmentLimits,
} from "../utils/attachment-quota.js";

const MAX_UPLOAD_BODY_BYTES = MAX_ATTACHMENT_USER_QUOTA_BYTES + 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;

function rejection(code: AttachmentRejection["code"], message: string, extras: Partial<AttachmentRejection> = {}): AttachmentRejection {
  return { code, message, ...extras };
}

export async function ingestAttachmentRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/octet-stream",
    (_req, payload, done) => done(null, payload)
  );

  app.post<{ Body: AttachmentUploadRequest }>(
    "/ingest/attachment",
    { preHandler: [requirePermission("events:write"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "api_key" || !auth.app_id) {
        return reply.code(400).send({ error: "API key must be scoped to an app" });
      }

      const body = request.body ?? ({} as Partial<AttachmentUploadRequest>);
      const {
        client_event_id,
        user_id,
        original_filename,
        content_type,
        size_bytes,
        sha256,
        is_dev,
      } = body;

      if (!client_event_id || typeof client_event_id !== "string") {
        return reply.code(400).send(rejection("invalid_request", "client_event_id is required"));
      }
      if (user_id !== undefined && user_id !== null) {
        if (typeof user_id !== "string" || user_id.length === 0 || user_id.length > 255) {
          return reply.code(400).send(rejection("invalid_request", "user_id must be a non-empty string of at most 255 chars"));
        }
      }
      if (
        !original_filename ||
        typeof original_filename !== "string" ||
        original_filename.length > ATTACHMENT_MAX_FILENAME_LENGTH
      ) {
        return reply.code(400).send(rejection("invalid_request", "original_filename is required and must be at most 255 chars"));
      }
      if (!content_type || typeof content_type !== "string") {
        return reply.code(400).send(rejection("invalid_request", "content_type is required"));
      }
      if (isDisallowedAttachmentContentType(content_type)) {
        return reply.code(415).send(rejection("disallowed_content_type", `Content-Type "${content_type}" is not allowed for attachments`));
      }
      if (
        typeof size_bytes !== "number" ||
        !Number.isInteger(size_bytes) ||
        size_bytes <= 0
      ) {
        return reply.code(400).send(rejection("invalid_request", "size_bytes must be a positive integer"));
      }
      if (!sha256 || typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
        return reply.code(400).send(rejection("invalid_request", "sha256 must be a 64-char lowercase hex string"));
      }

      const [appRow] = await app.db
        .select({ id: apps.id, project_id: apps.project_id, team_id: apps.team_id })
        .from(apps)
        .where(and(eq(apps.id, auth.app_id), isNull(apps.deleted_at)))
        .limit(1);
      if (!appRow) {
        return reply.code(400).send({ error: "App associated with this API key no longer exists" });
      }

      const [project, usage, userUsage, existingEvent] = await Promise.all([
        getProjectWithAttachmentLimits(app.db, appRow.project_id),
        getProjectAttachmentUsage(app.db, appRow.project_id),
        user_id ? getUserAttachmentUsage(app.db, appRow.project_id, user_id) : Promise.resolve(null),
        app.db
          .select({ id: events.id, user_id: events.user_id })
          .from(events)
          .where(
            and(
              eq(events.app_id, appRow.id),
              eq(events.client_event_id, client_event_id)
            )
          )
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ]);

      if (!project || project.deleted_at) {
        return reply.code(400).send({ error: "Project associated with this API key no longer exists" });
      }

      const limits = resolveAttachmentLimits(project);

      if (userUsage && userUsage.usedBytes + size_bytes > limits.userQuotaBytes) {
        return reply.code(413).send(
          rejection(
            "user_quota_exhausted",
            `User attachment quota would be exceeded (${userUsage.usedBytes} + ${size_bytes} > ${limits.userQuotaBytes} bytes)`,
            {
              user_quota_bytes: limits.userQuotaBytes,
              user_used_bytes: userUsage.usedBytes,
            }
          )
        );
      }

      if (usage.usedBytes + size_bytes > limits.projectQuotaBytes) {
        return reply.code(413).send(
          rejection(
            "quota_exhausted",
            `Project attachment quota would be exceeded (${usage.usedBytes} + ${size_bytes} > ${limits.projectQuotaBytes} bytes)`,
            {
              quota_bytes: limits.projectQuotaBytes,
              used_bytes: usage.usedBytes,
            }
          )
        );
      }

      const resolvedEventId = existingEvent?.id ?? null;
      const resolvedUserId = user_id ?? existingEvent?.user_id ?? null;

      const [row] = await app.db
        .insert(eventAttachments)
        .values({
          project_id: appRow.project_id,
          app_id: appRow.id,
          event_client_id: client_event_id,
          event_id: resolvedEventId,
          user_id: resolvedUserId,
          original_filename,
          content_type,
          size_bytes,
          sha256: sha256.toLowerCase(),
          storage_path: "",
          is_dev: is_dev === true,
        })
        .returning({ id: eventAttachments.id });

      const base = (config.publicUrl || "").replace(/\/$/, "");
      const uploadUrl = `${base}/v1/ingest/attachment/${row.id}`;
      const expiresAt = new Date(Date.now() + ATTACHMENT_UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
      const response: AttachmentUploadResponse = {
        attachment_id: row.id,
        upload_url: uploadUrl,
        expires_at: expiresAt,
      };
      return reply.code(201).send(response);
    }
  );

  app.put<{ Params: { id: string } }>(
    "/ingest/attachment/:id",
    {
      preHandler: [requirePermission("events:write"), rateLimit],
      bodyLimit: MAX_UPLOAD_BODY_BYTES,
    },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "api_key" || !auth.app_id) {
        return reply.code(400).send({ error: "API key must be scoped to an app" });
      }

      const { id } = request.params;

      const [row] = await app.db
        .select()
        .from(eventAttachments)
        .where(eq(eventAttachments.id, id))
        .limit(1);
      if (!row) {
        return reply.code(404).send({ error: "Attachment not found" });
      }
      if (row.app_id !== auth.app_id) {
        return reply.code(403).send({ error: "Attachment belongs to a different app" });
      }
      if (row.deleted_at) {
        return reply.code(410).send({ error: "Attachment has been deleted" });
      }
      if (row.uploaded_at) {
        return reply
          .code(409)
          .send(rejection("already_uploaded", "Attachment has already been uploaded"));
      }

      const stream = request.body as Readable | undefined;
      if (!stream || typeof (stream as Readable).pipe !== "function") {
        return reply
          .code(400)
          .send({ error: "Request body must be sent with Content-Type: application/octet-stream" });
      }

      let result: { storagePath: string; sizeBytes: number; sha256: string };
      try {
        result = await attachmentStorage.put({
          projectId: row.project_id,
          objectKey: row.id,
          source: stream,
          expectedSizeBytes: row.size_bytes,
        });
      } catch (err) {
        await app.db.delete(eventAttachments).where(eq(eventAttachments.id, row.id));
        const message = err instanceof Error ? err.message : String(err);
        if (message === "declared_size_exceeded") {
          return reply.code(413).send(rejection("size_mismatch", "Upload exceeded declared size"));
        }
        request.log.error({ err, attachmentId: row.id }, "attachment upload failed");
        return reply.code(500).send({ error: "Upload failed" });
      }

      const cleanup = async (code: AttachmentRejection["code"], message: string) => {
        await attachmentStorage.delete(result.storagePath).catch(() => {});
        await app.db.delete(eventAttachments).where(eq(eventAttachments.id, row.id));
        return reply.code(400).send(rejection(code, message));
      };

      if (result.sizeBytes !== row.size_bytes) {
        return cleanup(
          "size_mismatch",
          `Uploaded size ${result.sizeBytes} does not match declared ${row.size_bytes}`
        );
      }
      if (result.sha256 !== row.sha256) {
        return cleanup("hash_mismatch", "Uploaded bytes do not match declared sha256");
      }

      await app.db
        .update(eventAttachments)
        .set({
          storage_path: result.storagePath,
          uploaded_at: new Date(),
        })
        .where(eq(eventAttachments.id, row.id));

      const { url, expiresUnix } = buildSignedDownloadUrl(
        config.publicUrl,
        row.id,
        ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS,
        config.attachmentsSigningSecret
      );
      return {
        attachment_id: row.id,
        size_bytes: result.sizeBytes,
        sha256: result.sha256,
        download_url: url,
        download_url_expires_at: new Date(expiresUnix * 1000).toISOString(),
      };
    }
  );
}
