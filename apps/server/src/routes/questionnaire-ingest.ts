import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { apps, questionnaires, questionnaireResponses, appUsers } from "@owlmetry/db";
import {
  ALLOWED_ENVIRONMENTS_FOR_PLATFORM,
  QUESTIONNAIRES_DISMISSED_PROPERTY,
  validateAnswers,
} from "@owlmetry/shared";
import type {
  IngestQuestionnaireFetchResponse,
  IngestQuestionnaireSubmitRequest,
  IngestQuestionnaireDismissRequest,
  QuestionnaireSchema,
} from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { resolveIngestCountryCode } from "../utils/event-processing.js";
import { resolveClaimedUserIds } from "../utils/claimed-identity.js";
import { resolveTeamMemberUserIds } from "../utils/team-members.js";
import { mergeUserProperties } from "../utils/user-properties.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimOrNull(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

async function isUserGloballyDismissed(
  db: FastifyInstance["db"],
  projectId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ properties: appUsers.properties })
    .from(appUsers)
    .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, userId)))
    .limit(1);
  const value = row?.properties?.[QUESTIONNAIRES_DISMISSED_PROPERTY];
  return typeof value === "string" && value.length > 0;
}

export async function questionnaireIngestRoutes(app: FastifyInstance) {
  // POST /v1/questionnaires/dismiss — record global one-and-done opt-out.
  // Sets app_users.properties._questionnaires_dismissed_at; idempotent (re-call
  // refreshes the timestamp). Anonymous callers (no user_id) get 400 — there's
  // no user row to attach the flag to. Registered FIRST so find-my-way's
  // radix tree treats `dismiss` as a static branch distinct from the `:slug`
  // parametric branch shared with the routes below.
  app.post<{ Body: IngestQuestionnaireDismissRequest }>(
    "/questionnaires/dismiss",
    { preHandler: [requirePermission("events:write"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "api_key" || auth.key_type !== "client") {
        return reply.code(403).send({ error: "Client key required" });
      }
      if (!auth.app_id) {
        return reply.code(400).send({ error: "API key must be scoped to an app" });
      }

      const body = request.body ?? ({} as IngestQuestionnaireDismissRequest);
      const [appRow] = await app.db
        .select({ id: apps.id, bundle_id: apps.bundle_id, project_id: apps.project_id })
        .from(apps)
        .where(and(eq(apps.id, auth.app_id), isNull(apps.deleted_at)))
        .limit(1);
      if (!appRow) {
        return reply.code(400).send({ error: "App associated with this API key no longer exists" });
      }
      if (appRow.bundle_id) {
        if (!body.bundle_id || body.bundle_id !== appRow.bundle_id) {
          return reply.code(403).send({ error: "bundle_id does not match the app" });
        }
      }

      let userId: string | null = typeof body.user_id === "string" && body.user_id.length > 0 ? body.user_id : null;
      if (!userId) {
        return reply.code(400).send({ error: "user_id is required to dismiss questionnaires" });
      }
      const claimedMap = await resolveClaimedUserIds(app.db, appRow.project_id, [userId]);
      userId = claimedMap.get(userId) ?? userId;

      const dismissedAt = new Date();
      await mergeUserProperties(app.db, appRow.project_id, userId, {
        [QUESTIONNAIRES_DISMISSED_PROPERTY]: dismissedAt.toISOString(),
      });

      return reply.send({ dismissed_at: dismissedAt.toISOString() });
    },
  );

  // GET /v1/questionnaires/:slug — fetch spec + eligibility for the caller.
  // Returns 200 + { eligible: false, reason } for soft states so the SDK can
  // fail closed silently; 404 only when the slug doesn't exist (developer
  // error worth surfacing).
  app.get<{ Params: { slug: string }; Querystring: { user_id?: string; bundle_id?: string } }>(
    "/questionnaires/:slug",
    { preHandler: [requirePermission("events:write"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "api_key" || auth.key_type !== "client") {
        return reply.code(403).send({ error: "Client key required" });
      }
      if (!auth.app_id) {
        return reply.code(400).send({ error: "API key must be scoped to an app" });
      }

      const { slug } = request.params;
      if (!slug || typeof slug !== "string") {
        return reply.code(400).send({ error: "slug is required" });
      }

      const [appRow] = await app.db
        .select({
          id: apps.id,
          bundle_id: apps.bundle_id,
          project_id: apps.project_id,
        })
        .from(apps)
        .where(and(eq(apps.id, auth.app_id), isNull(apps.deleted_at)))
        .limit(1);

      if (!appRow) {
        return reply.code(400).send({ error: "App associated with this API key no longer exists" });
      }

      const { bundle_id, user_id } = request.query;
      if (appRow.bundle_id) {
        if (!bundle_id || bundle_id !== appRow.bundle_id) {
          return reply.code(403).send({ error: "bundle_id does not match the app" });
        }
      }

      const [qRow] = await app.db
        .select()
        .from(questionnaires)
        .where(
          and(
            eq(questionnaires.project_id, appRow.project_id),
            eq(questionnaires.slug, slug),
            isNull(questionnaires.deleted_at),
          ),
        )
        .limit(1);

      if (!qRow) {
        return reply.code(404).send({ error: "Questionnaire not found" });
      }

      // app_id scoping: if the definition is pinned to a specific app, the
      // caller's app must match.
      if (qRow.app_id && qRow.app_id !== appRow.id) {
        return reply.code(404).send({ error: "Questionnaire not found" });
      }

      if (!qRow.is_active) {
        const body: IngestQuestionnaireFetchResponse = { eligible: false, reason: "inactive" };
        return reply.send(body);
      }

      let resolvedUserId: string | null = typeof user_id === "string" && user_id.length > 0 ? user_id : null;
      if (resolvedUserId) {
        const claimedMap = await resolveClaimedUserIds(app.db, appRow.project_id, [resolvedUserId]);
        resolvedUserId = claimedMap.get(resolvedUserId) ?? resolvedUserId;

        if (await isUserGloballyDismissed(app.db, appRow.project_id, resolvedUserId)) {
          const body: IngestQuestionnaireFetchResponse = { eligible: false, reason: "globally_dismissed" };
          return reply.send(body);
        }

        const [existing] = await app.db
          .select({ id: questionnaireResponses.id })
          .from(questionnaireResponses)
          .where(
            and(
              eq(questionnaireResponses.project_id, appRow.project_id),
              eq(questionnaireResponses.slug, slug),
              eq(questionnaireResponses.user_id, resolvedUserId),
              isNull(questionnaireResponses.deleted_at),
            ),
          )
          .limit(1);
        if (existing) {
          const body: IngestQuestionnaireFetchResponse = { eligible: false, reason: "already_responded" };
          return reply.send(body);
        }
      }

      const body: IngestQuestionnaireFetchResponse = {
        eligible: true,
        questionnaire: {
          id: qRow.id,
          slug: qRow.slug,
          name: qRow.name,
          description: qRow.description,
          schema: qRow.schema as QuestionnaireSchema,
        },
      };
      return reply.send(body);
    },
  );

  // POST /v1/questionnaires/:slug/responses — submit a completed response.
  // Validates answers against the current schema; snapshots the schema into
  // the response row; race-safe via the partial unique index.
  app.post<{ Params: { slug: string }; Body: IngestQuestionnaireSubmitRequest }>(
    "/questionnaires/:slug/responses",
    { preHandler: [requirePermission("events:write"), rateLimit] },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "api_key" || auth.key_type !== "client") {
        return reply.code(403).send({ error: "Client key required" });
      }
      if (!auth.app_id) {
        return reply.code(400).send({ error: "API key must be scoped to an app" });
      }

      const { slug } = request.params;
      const body = request.body ?? ({} as IngestQuestionnaireSubmitRequest);

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
        return reply.code(400).send({ error: "App associated with this API key no longer exists" });
      }

      if (appRow.bundle_id) {
        if (!body.bundle_id || body.bundle_id !== appRow.bundle_id) {
          return reply.code(403).send({ error: "bundle_id does not match the app" });
        }
      }

      const [qRow] = await app.db
        .select()
        .from(questionnaires)
        .where(
          and(
            eq(questionnaires.project_id, appRow.project_id),
            eq(questionnaires.slug, slug),
            isNull(questionnaires.deleted_at),
          ),
        )
        .limit(1);

      if (!qRow) {
        return reply.code(404).send({ error: "Questionnaire not found" });
      }
      if (qRow.app_id && qRow.app_id !== appRow.id) {
        return reply.code(404).send({ error: "Questionnaire not found" });
      }
      if (!qRow.is_active) {
        return reply.code(409).send({ error: "Questionnaire is not accepting responses", reason: "inactive" });
      }

      const schema = qRow.schema as QuestionnaireSchema;
      const result = validateAnswers(schema, body.answers);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }

      let sessionId: string | null = null;
      if (body.session_id != null) {
        if (typeof body.session_id !== "string" || !UUID_REGEX.test(body.session_id)) {
          return reply.code(400).send({ error: "session_id must be a UUID" });
        }
        sessionId = body.session_id;
      }

      let userId: string | null = typeof body.user_id === "string" && body.user_id.length > 0 ? body.user_id : null;
      if (userId) {
        const claimedMap = await resolveClaimedUserIds(app.db, appRow.project_id, [userId]);
        userId = claimedMap.get(userId) ?? userId;

        // Re-check global dismissal — the user may have dismissed between the
        // GET eligibility check and this POST.
        if (await isUserGloballyDismissed(app.db, appRow.project_id, userId)) {
          return reply.code(409).send({ error: "Questionnaires globally dismissed", reason: "globally_dismissed" });
        }
      }

      const environment = typeof body.environment === "string" ? body.environment : null;
      if (environment) {
        const allowed =
          ALLOWED_ENVIRONMENTS_FOR_PLATFORM[
            appRow.platform as keyof typeof ALLOWED_ENVIRONMENTS_FOR_PLATFORM
          ];
        if (!allowed || !allowed.includes(environment as any)) {
          return reply.code(400).send({
            error: `environment "${environment}" is not allowed for ${appRow.platform} apps (allowed: ${allowed?.join(", ") ?? ""})`,
          });
        }
      }

      const countryCode = resolveIngestCountryCode(request.headers["cf-ipcountry"], appRow.platform);
      const isDev = body.is_dev === true;
      // Snapshot the schema by value so future edits don't retroactively change
      // how this response renders.
      const schemaSnapshot = structuredClone(schema);

      // Race-safe insert: partial unique index on (project_id, slug, user_id)
      // WHERE deleted_at IS NULL AND user_id IS NOT NULL drives the conflict.
      const inserted = await app.db
        .insert(questionnaireResponses)
        .values({
          questionnaire_id: qRow.id,
          slug: qRow.slug,
          app_id: appRow.id,
          project_id: appRow.project_id,
          session_id: sessionId,
          user_id: userId,
          answers: result.value,
          schema_snapshot: schemaSnapshot,
          status: "new",
          is_dev: isDev,
          environment: environment as any,
          os_version: trimOrNull(body.os_version, 50),
          app_version: trimOrNull(body.app_version, 50),
          sdk_name: trimOrNull(body.sdk_name, 50),
          sdk_version: trimOrNull(body.sdk_version, 50),
          device_model: trimOrNull(body.device_model, 100),
          country_code: countryCode,
        })
        .onConflictDoNothing()
        .returning({ id: questionnaireResponses.id, created_at: questionnaireResponses.created_at });

      if (inserted.length === 0) {
        return reply.code(409).send({ error: "Already responded", reason: "already_responded" });
      }
      const created = inserted[0]!;

      if (!isDev) {
        const summary = summarizeAnswers(schema, result.value);
        resolveTeamMemberUserIds(app.db, appRow.team_id)
          .then((userIds) => {
            if (userIds.length === 0) return;
            return app.notificationDispatcher.enqueue({
              type: "questionnaire.response_new",
              userIds,
              teamId: appRow.team_id,
              payload: {
                title: `New questionnaire response in ${appRow.name}`,
                body: `${qRow.name}: ${summary}`,
                link: `/dashboard/questionnaires/${qRow.id}`,
                data: {
                  questionnaire_id: qRow.id,
                  questionnaire_slug: qRow.slug,
                  response_id: created.id,
                  app_id: appRow.id,
                  app_name: appRow.name,
                  project_id: appRow.project_id,
                },
              },
            });
          })
          .catch((err) => app.log.error(err, "Failed to enqueue questionnaire.response_new notification"));
      }

      return reply.code(201).send({
        id: created.id,
        created_at: created.created_at.toISOString(),
      });
    },
  );

}

function summarizeAnswers(
  schema: QuestionnaireSchema,
  answers: Record<string, unknown>,
): string {
  // Surface the first answered question in the notification body so the team
  // sees signal at a glance. NPS/rating numbers go first since they're loudest.
  const order: Array<"nps" | "rating" | "single_choice" | "multi_choice" | "text"> = [
    "nps",
    "rating",
    "single_choice",
    "multi_choice",
    "text",
  ];
  for (const wanted of order) {
    const question = schema.questions.find((q) => q.type === wanted && answers[q.id] != null);
    if (!question) continue;
    const raw = answers[question.id];
    if (question.type === "single_choice") {
      const opt = question.options.find((o) => o.id === raw);
      return `${question.title}: ${opt?.label ?? raw}`;
    }
    if (question.type === "multi_choice" && Array.isArray(raw)) {
      const labels = raw
        .map((id) => question.options.find((o) => o.id === id)?.label ?? id)
        .join(", ");
      return `${question.title}: ${labels}`;
    }
    if (question.type === "text" && typeof raw === "string") {
      const snippet = raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
      return `${question.title}: ${snippet}`;
    }
    return `${question.title}: ${raw}`;
  }
  return "New response submitted";
}

