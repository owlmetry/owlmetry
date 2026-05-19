import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { apps, questionnaires, questionnaireResponses, appUsers } from "@owlmetry/db";
import {
  ALLOWED_ENVIRONMENTS_FOR_PLATFORM,
  QUESTIONNAIRES_DISMISSED_PROPERTY,
  pruneUnknownAnswerKeys,
  validateAnswers,
} from "@owlmetry/shared";
import type {
  IngestQuestionnaireFetchResponse,
  IngestQuestionnaireSubmitRequest,
  IngestQuestionnaireSubmitResponse,
  IngestQuestionnaireDismissRequest,
  QuestionnaireAnswers,
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
      let inProgress: { response_id: string; answers: QuestionnaireAnswers } | null = null;
      if (resolvedUserId) {
        const claimedMap = await resolveClaimedUserIds(app.db, appRow.project_id, [resolvedUserId]);
        resolvedUserId = claimedMap.get(resolvedUserId) ?? resolvedUserId;

        if (await isUserGloballyDismissed(app.db, appRow.project_id, resolvedUserId)) {
          const body: IngestQuestionnaireFetchResponse = { eligible: false, reason: "globally_dismissed" };
          return reply.send(body);
        }

        // submitted_at non-null = the user already finished this questionnaire,
        // submission is terminal. null = there's a draft in progress and the
        // SDK should resume from where they left off.
        const [existing] = await app.db
          .select({
            id: questionnaireResponses.id,
            answers: questionnaireResponses.answers,
            submitted_at: questionnaireResponses.submitted_at,
          })
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
          if (existing.submitted_at !== null) {
            const body: IngestQuestionnaireFetchResponse = { eligible: false, reason: "already_responded" };
            return reply.send(body);
          }
          inProgress = {
            response_id: existing.id,
            answers: (existing.answers as QuestionnaireAnswers) ?? {},
          };
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
        ...(inProgress ? { in_progress: inProgress } : {}),
      };
      return reply.send(body);
    },
  );

  // POST /v1/questionnaires/:slug/responses — upsert a draft or submit a
  // completed response. Drafts and submissions share one row per (project,
  // slug, user); `submitted_at` distinguishes them. Each Next tap in the SDK
  // calls this endpoint with the full accumulated answer set and is_complete
  // = false; the final Submit tap calls with is_complete = true. Answers
  // merge per key (incoming overwrites existing for the same question id);
  // submitted_at flips null → non-null exactly once, and the team
  // notification fires only on that flip.
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
      const isComplete = body.is_complete === true;

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

      // Questionnaire lookup + claim resolution run in parallel — neither
      // depends on the other. With per-Next-tap saves this is a hot path,
      // so the round-trip saved compounds across the flow.
      const rawUserId =
        typeof body.user_id === "string" && body.user_id.length > 0 ? body.user_id : null;
      const [[qRow], claimedMap] = await Promise.all([
        app.db
          .select()
          .from(questionnaires)
          .where(
            and(
              eq(questionnaires.project_id, appRow.project_id),
              eq(questionnaires.slug, slug),
              isNull(questionnaires.deleted_at),
            ),
          )
          .limit(1),
        rawUserId
          ? resolveClaimedUserIds(app.db, appRow.project_id, [rawUserId])
          : Promise.resolve(new Map<string, string>()),
      ]);

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

      let sessionId: string | null = null;
      if (body.session_id != null) {
        if (typeof body.session_id !== "string" || !UUID_REGEX.test(body.session_id)) {
          return reply.code(400).send({ error: "session_id must be a UUID" });
        }
        sessionId = body.session_id;
      }

      const userId: string | null = rawUserId
        ? claimedMap.get(rawUserId) ?? rawUserId
        : null;

      // Existing-row lookup + globally-dismissed re-check run in parallel.
      // The dismissal re-check only matters on the final submit — the GET
      // eligibility check gates entry to the flow, and a mid-flow user
      // can't dismiss without abandoning the sheet, so draft saves skip
      // the SELECT entirely (saving one DB hit per Next tap on the hot
      // path). The existing-row lookup uses WHERE submitted_at IS NULL on
      // the UPDATE below, so a concurrent submission between this SELECT
      // and the upsert still produces a 409 without double-flipping.
      let existing: { id: string; answers: QuestionnaireAnswers; submitted_at: Date | null } | null = null;
      if (userId) {
        const [existingRows, dismissed] = await Promise.all([
          app.db
            .select({
              id: questionnaireResponses.id,
              answers: questionnaireResponses.answers,
              submitted_at: questionnaireResponses.submitted_at,
            })
            .from(questionnaireResponses)
            .where(
              and(
                eq(questionnaireResponses.project_id, appRow.project_id),
                eq(questionnaireResponses.slug, slug),
                eq(questionnaireResponses.user_id, userId),
                isNull(questionnaireResponses.deleted_at),
              ),
            )
            .limit(1),
          isComplete
            ? isUserGloballyDismissed(app.db, appRow.project_id, userId)
            : Promise.resolve(false),
        ]);
        if (dismissed) {
          return reply.code(409).send({ error: "Questionnaires globally dismissed", reason: "globally_dismissed" });
        }
        const row = existingRows[0];
        if (row) {
          existing = {
            id: row.id,
            answers: (row.answers as QuestionnaireAnswers) ?? {},
            submitted_at: row.submitted_at,
          };
        }
      }

      if (existing?.submitted_at != null) {
        return reply.code(409).send({ error: "Already responded", reason: "already_responded" });
      }

      // Validate the *incoming* answer set with allowPartial: true regardless
      // of is_complete — the required-answered check belongs against the
      // merged set, not the incoming subset. A completion call might send
      // only the last page's answer because every earlier question was
      // already saved via prior drafts. allowPartial: true still type-checks
      // every present key, so an out-of-range NPS or invalid option in the
      // incoming payload still 400s.
      const incomingResult = validateAnswers(schema, body.answers, { allowPartial: true });
      if (!incomingResult.ok) {
        return reply.code(400).send({ error: incomingResult.error });
      }

      // Merge incoming on top of existing (per-key replace) so a re-save of
      // Q1 with a new value overwrites, and a save of Q3 preserves Q1+Q2.
      const mergedAnswers: QuestionnaireAnswers = existing
        ? { ...existing.answers, ...incomingResult.value }
        : incomingResult.value;

      // Completion-only: prune answers whose question id is no longer in
      // the current schema (an editor may have removed a question between
      // draft-save and submit), then re-validate the *merged* set against
      // the live schema with allowPartial: false to enforce required
      // questions. The pruned-and-validated value is what we persist along
      // with the snapshot.
      let answersToPersist: QuestionnaireAnswers = mergedAnswers;
      if (isComplete) {
        const pruned = pruneUnknownAnswerKeys(schema, mergedAnswers);
        const finalResult = validateAnswers(schema, pruned, { allowPartial: false });
        if (!finalResult.ok) {
          return reply.code(400).send({ error: finalResult.error });
        }
        answersToPersist = finalResult.value;
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
      const now = new Date();
      // Snapshot the schema by value at completion time so future edits don't
      // retroactively change how this response renders. Drafts have no
      // snapshot — they render against the live schema until they submit.
      const schemaSnapshot = isComplete ? structuredClone(schema) : null;
      const prevSubmittedAt = existing?.submitted_at ?? null;

      let responseRow: { id: string; created_at: Date; submitted_at: Date | null } | null = null;

      if (existing) {
        // Update the existing draft. WHERE submitted_at IS NULL refuses the
        // update if another request flipped first — RETURNING yields zero
        // rows and we respond 409.
        const [updated] = await app.db
          .update(questionnaireResponses)
          .set({
            answers: answersToPersist,
            ...(isComplete
              ? {
                  submitted_at: now,
                  status: "new" as const,
                  schema_snapshot: schemaSnapshot,
                }
              : {}),
            updated_at: now,
            // Refresh denormalized client metadata on each save so we don't
            // freeze stale values from the first draft-save. Trimming
            // matches the original INSERT behavior.
            environment: environment as any,
            os_version: trimOrNull(body.os_version, 50),
            app_version: trimOrNull(body.app_version, 50),
            sdk_name: trimOrNull(body.sdk_name, 50),
            sdk_version: trimOrNull(body.sdk_version, 50),
            device_model: trimOrNull(body.device_model, 100),
            country_code: countryCode,
            ...(sessionId ? { session_id: sessionId } : {}),
          })
          .where(
            and(
              eq(questionnaireResponses.id, existing.id),
              isNull(questionnaireResponses.submitted_at),
            ),
          )
          .returning({
            id: questionnaireResponses.id,
            created_at: questionnaireResponses.created_at,
            submitted_at: questionnaireResponses.submitted_at,
          });
        if (!updated) {
          // The row was flipped to submitted by a concurrent request between
          // our SELECT and our UPDATE. Treat as already_responded.
          return reply.code(409).send({ error: "Already responded", reason: "already_responded" });
        }
        responseRow = updated;
      } else {
        // No existing row. INSERT — with ON CONFLICT DO UPDATE for the
        // (rare) race where another request inserted between our SELECT and
        // ours. The conflict path mirrors the update branch above: merge
        // answers, conditionally flip submitted_at, refuse if already
        // submitted via setWhere.
        const valueAnswers = answersToPersist;
        const inserted = await app.db
          .insert(questionnaireResponses)
          .values({
            questionnaire_id: qRow.id,
            slug: qRow.slug,
            app_id: appRow.id,
            project_id: appRow.project_id,
            session_id: sessionId,
            user_id: userId,
            answers: valueAnswers,
            schema_snapshot: schemaSnapshot,
            submitted_at: isComplete ? now : null,
            status: isComplete ? "new" : "draft",
            is_dev: isDev,
            environment: environment as any,
            os_version: trimOrNull(body.os_version, 50),
            app_version: trimOrNull(body.app_version, 50),
            sdk_name: trimOrNull(body.sdk_name, 50),
            sdk_version: trimOrNull(body.sdk_version, 50),
            device_model: trimOrNull(body.device_model, 100),
            country_code: countryCode,
          })
          .onConflictDoUpdate({
            target: [
              questionnaireResponses.project_id,
              questionnaireResponses.slug,
              questionnaireResponses.user_id,
            ],
            targetWhere: sql`${questionnaireResponses.deleted_at} IS NULL AND ${questionnaireResponses.user_id} IS NOT NULL`,
            set: {
              answers: sql`${questionnaireResponses.answers} || excluded.answers`,
              submitted_at: sql`CASE WHEN ${questionnaireResponses.submitted_at} IS NULL AND excluded.submitted_at IS NOT NULL THEN excluded.submitted_at ELSE ${questionnaireResponses.submitted_at} END`,
              status: sql`CASE WHEN ${questionnaireResponses.submitted_at} IS NULL AND excluded.submitted_at IS NOT NULL THEN excluded.status ELSE ${questionnaireResponses.status} END`,
              schema_snapshot: sql`CASE WHEN ${questionnaireResponses.submitted_at} IS NULL AND excluded.submitted_at IS NOT NULL THEN excluded.schema_snapshot ELSE ${questionnaireResponses.schema_snapshot} END`,
              // Refresh denormalized client metadata on conflict — without
              // this, a row that the racing request created with stale (or
              // missing) device/version/country values would keep them.
              // Matches the UPDATE branch above.
              environment: sql`excluded.environment`,
              os_version: sql`excluded.os_version`,
              app_version: sql`excluded.app_version`,
              sdk_name: sql`excluded.sdk_name`,
              sdk_version: sql`excluded.sdk_version`,
              device_model: sql`excluded.device_model`,
              country_code: sql`excluded.country_code`,
              session_id: sql`COALESCE(excluded.session_id, ${questionnaireResponses.session_id})`,
              updated_at: now,
            },
            setWhere: sql`${questionnaireResponses.submitted_at} IS NULL`,
          })
          .returning({
            id: questionnaireResponses.id,
            created_at: questionnaireResponses.created_at,
            submitted_at: questionnaireResponses.submitted_at,
          });
        if (inserted.length === 0) {
          // Race: another request already submitted. setWhere blocked the
          // update; row exists but it's terminal.
          return reply.code(409).send({ error: "Already responded", reason: "already_responded" });
        }
        responseRow = inserted[0]!;
      }

      // We flipped submitted_at to non-null in this request iff the prior
      // state was null AND the post-write state is non-null. Anything else
      // (e.g., a draft save that left submitted_at alone) does NOT trigger
      // the notification.
      const wasSubmitted = prevSubmittedAt === null && responseRow.submitted_at !== null;

      if (wasSubmitted && !isDev) {
        const summary = summarizeAnswers(schema, answersToPersist);
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
                  response_id: responseRow!.id,
                  app_id: appRow.id,
                  app_name: appRow.name,
                  project_id: appRow.project_id,
                },
              },
            });
          })
          .catch((err) => app.log.error(err, "Failed to enqueue questionnaire.response_new notification"));
      }

      const responseBody: IngestQuestionnaireSubmitResponse = {
        id: responseRow.id,
        created_at: responseRow.created_at.toISOString(),
        was_submitted: wasSubmitted,
      };
      // 201 on first insert (no prior row); 200 on subsequent draft saves
      // and on the final submit-on-existing-draft path. Keeps the create
      // semantics clear for clients that care about it.
      return reply.code(existing ? 200 : 201).send(responseBody);
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

