import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { apps, feedback } from "@owlmetry/db";
import {
  ALLOWED_ENVIRONMENTS_FOR_PLATFORM,
  MAX_FEEDBACK_MESSAGE_LENGTH,
  MAX_FEEDBACK_NAME_LENGTH,
  MAX_FEEDBACK_EMAIL_LENGTH,
  isValidFeedbackEmail,
} from "@owlmetry/shared";
import type { IngestFeedbackRequest } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { parseCountryHeader } from "../utils/event-processing.js";
import { resolveClaimedUserIds } from "../utils/claimed-identity.js";
import { resolveTeamMemberUserIds } from "../utils/team-members.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimOrNull(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

export async function feedbackIngestRoutes(app: FastifyInstance) {
  app.post<{ Body: IngestFeedbackRequest }>(
    "/feedback",
    { preHandler: [requirePermission("events:write"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "api_key") {
        return reply.code(403).send({ error: "API key required" });
      }
      if (auth.key_type !== "client") {
        return reply.code(403).send({ error: "Client key required for feedback ingest" });
      }

      const body = request.body ?? ({} as IngestFeedbackRequest);
      const { bundle_id } = body;
      const countryCode = parseCountryHeader(request.headers["cf-ipcountry"]);

      if (!auth.app_id) {
        return reply.code(400).send({ error: "API key must be scoped to an app" });
      }

      const [appRow] = await app.db
        .select({
          id: apps.id,
          name: apps.name,
          bundle_id: apps.bundle_id,
          platform: apps.platform,
          project_id: apps.project_id,
          team_id: apps.team_id,
        })
        .from(apps)
        .where(and(eq(apps.id, auth.app_id), isNull(apps.deleted_at)))
        .limit(1);

      if (!appRow) {
        return reply
          .code(400)
          .send({ error: "App associated with this API key no longer exists" });
      }

      if (appRow.bundle_id) {
        if (!bundle_id || typeof bundle_id !== "string") {
          return reply.code(400).send({ error: "bundle_id is required" });
        }
        if (bundle_id !== appRow.bundle_id) {
          return reply.code(403).send({
            error: "bundle_id does not match the app associated with this API key",
          });
        }
      }

      const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
      if (!rawMessage) {
        return reply.code(400).send({ error: "message is required" });
      }
      if (rawMessage.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
        return reply.code(400).send({
          error: `message must be at most ${MAX_FEEDBACK_MESSAGE_LENGTH} characters`,
        });
      }

      const submitterName = trimOrNull(body.submitter_name, MAX_FEEDBACK_NAME_LENGTH);
      const submitterEmailRaw = trimOrNull(body.submitter_email, MAX_FEEDBACK_EMAIL_LENGTH);
      if (submitterEmailRaw && !isValidFeedbackEmail(submitterEmailRaw)) {
        return reply.code(400).send({ error: "submitter_email is not a valid email address" });
      }

      let sessionId: string | null = null;
      if (body.session_id != null) {
        if (typeof body.session_id !== "string" || !UUID_REGEX.test(body.session_id)) {
          return reply.code(400).send({ error: "session_id must be a UUID" });
        }
        sessionId = body.session_id;
      }

      let userId: string | null =
        typeof body.user_id === "string" && body.user_id.length > 0 ? body.user_id : null;
      if (userId) {
        const claimedMap = await resolveClaimedUserIds(app.db, appRow.project_id, [userId]);
        userId = claimedMap.get(userId) ?? userId;
      }

      const environment = typeof body.environment === "string" ? body.environment : null;
      if (environment) {
        const allowed = ALLOWED_ENVIRONMENTS_FOR_PLATFORM[
          appRow.platform as keyof typeof ALLOWED_ENVIRONMENTS_FOR_PLATFORM
        ];
        if (!allowed || !allowed.includes(environment as any)) {
          return reply.code(400).send({
            error: `environment "${environment}" is not allowed for ${appRow.platform} apps (allowed: ${allowed?.join(", ") ?? ""})`,
          });
        }
      }

      const isDev = body.is_dev === true;

      const [created] = await app.db
        .insert(feedback)
        .values({
          app_id: appRow.id,
          project_id: appRow.project_id,
          session_id: sessionId,
          user_id: userId,
          message: rawMessage,
          submitter_name: submitterName,
          submitter_email: submitterEmailRaw,
          status: "new",
          is_dev: isDev,
          environment: environment as any,
          os_version: trimOrNull(body.os_version, 50),
          app_version: trimOrNull(body.app_version, 50),
          device_model: trimOrNull(body.device_model, 100),
          country_code: countryCode,
        })
        .returning({ id: feedback.id, created_at: feedback.created_at });

      // Production-only — dev feedback shouldn't ping the team.
      if (!isDev) {
        const submitterLabel = submitterName ?? submitterEmailRaw ?? "Someone";
        const snippet = rawMessage.length > 200 ? rawMessage.slice(0, 200) + "…" : rawMessage;
        resolveTeamMemberUserIds(app.db, appRow.team_id)
          .then((userIds) => {
            if (userIds.length === 0) return;
            return app.notificationDispatcher.enqueue({
              type: "feedback.new",
              userIds,
              teamId: appRow.team_id,
              payload: {
                title: `New feedback in ${appRow.name}`,
                body: `${submitterLabel}: ${snippet}`,
                link: `/dashboard/feedback/${created.id}`,
                data: {
                  feedback_id: created.id,
                  app_id: appRow.id,
                  app_name: appRow.name,
                },
              },
            });
          })
          .catch((err) => app.log.error(err, "Failed to enqueue feedback.new notification"));
      }

      return reply.code(201).send({
        id: created.id,
        created_at: created.created_at.toISOString(),
      });
    }
  );
}
