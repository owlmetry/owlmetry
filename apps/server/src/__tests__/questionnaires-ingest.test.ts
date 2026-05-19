import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_DB_URL,
  insertAppUser,
} from "./setup.js";
import {
  QUESTIONNAIRES_DISMISSED_PROPERTY,
  type QuestionnaireSchema,
} from "@owlmetry/shared";

let app: FastifyInstance;
let dbClient: postgres.Sql;

beforeAll(async () => {
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await dbClient.end();
  await app.close();
});

const SAMPLE_SCHEMA: QuestionnaireSchema = {
  version: 1,
  questions: [
    { id: "q_text", type: "text", title: "Tell us", required: true, multiline: false },
    {
      id: "q_choice",
      type: "single_choice",
      title: "Pick one",
      required: true,
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    },
    { id: "q_rating", type: "rating", title: "Rate us", required: false, scale: 5 },
    { id: "q_nps", type: "nps", title: "Recommend?", required: false },
  ],
};

async function seedQuestionnaire(
  projectId: string,
  opts: { slug?: string; isActive?: boolean; appId?: string | null } = {},
) {
  const slug = opts.slug ?? "post-onboarding";
  const [row] = await dbClient`
    INSERT INTO questionnaires (project_id, app_id, slug, name, description, schema, is_active)
    VALUES (${projectId}, ${opts.appId ?? null}, ${slug}, 'Post-onboarding survey', 'desc',
            ${JSON.stringify(SAMPLE_SCHEMA)}::jsonb, ${opts.isActive ?? true})
    RETURNING id
  `;
  return row.id as string;
}

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
});

describe("GET /v1/questionnaires/:slug — eligibility", () => {
  it("returns 200 + eligible:true with the questionnaire spec for a fresh user", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const res = await app.inject({
      method: "GET",
      url: "/v1/questionnaires/post-onboarding?bundle_id=" + TEST_BUNDLE_ID + "&user_id=user_42",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.eligible).toBe(true);
    expect(body.questionnaire.slug).toBe("post-onboarding");
    expect(body.questionnaire.schema.questions).toHaveLength(4);
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/questionnaires/does-not-exist?bundle_id=" + TEST_BUNDLE_ID,
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns eligible:false reason=inactive when the questionnaire is paused", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId, { isActive: false });

    const res = await app.inject({
      method: "GET",
      url: "/v1/questionnaires/post-onboarding?bundle_id=" + TEST_BUNDLE_ID + "&user_id=user_42",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ eligible: false, reason: "inactive" });
  });

  it("returns eligible:false reason=globally_dismissed when the user has dismissed", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);
    await insertAppUser(projectId, "user_42", {
      properties: { [QUESTIONNAIRES_DISMISSED_PROPERTY]: new Date().toISOString() },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/questionnaires/post-onboarding?bundle_id=" + TEST_BUNDLE_ID + "&user_id=user_42",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ eligible: false, reason: "globally_dismissed" });
  });

  it("returns eligible:false reason=already_responded after a final submit", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const submit = await app.inject({
      method: "POST",
      url: "/v1/questionnaires/post-onboarding/responses",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        user_id: "user_42",
        session_id: TEST_SESSION_ID,
        is_complete: true,
        answers: { q_text: "Hi", q_choice: "yes", q_rating: 4, q_nps: 9 },
      },
    });
    expect(submit.statusCode).toBe(201);

    const fetch = await app.inject({
      method: "GET",
      url: "/v1/questionnaires/post-onboarding?bundle_id=" + TEST_BUNDLE_ID + "&user_id=user_42",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    expect(fetch.json()).toEqual({ eligible: false, reason: "already_responded" });
  });

  it("returns eligible:true with in_progress when the user has an unsubmitted draft", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const draft = await app.inject({
      method: "POST",
      url: "/v1/questionnaires/post-onboarding/responses",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        user_id: "user_42",
        // is_complete omitted → draft save
        answers: { q_text: "in progress" },
      },
    });
    expect(draft.statusCode).toBe(201);
    const draftId = draft.json().id as string;
    expect(draft.json().was_submitted).toBe(false);

    const fetch = await app.inject({
      method: "GET",
      url: "/v1/questionnaires/post-onboarding?bundle_id=" + TEST_BUNDLE_ID + "&user_id=user_42",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    const body = fetch.json();
    expect(body.eligible).toBe(true);
    expect(body.in_progress).toEqual({
      response_id: draftId,
      answers: { q_text: "in progress" },
    });
  });

  it("rejects mismatched bundle_id with 403", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const res = await app.inject({
      method: "GET",
      url: "/v1/questionnaires/post-onboarding?bundle_id=wrong.bundle&user_id=user_42",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects agent keys with 403", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const res = await app.inject({
      method: "GET",
      url: "/v1/questionnaires/post-onboarding?bundle_id=" + TEST_BUNDLE_ID,
      headers: { Authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/questionnaires/:slug/responses", () => {
  it("persists a complete response with snapshot and answers (is_complete: true)", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    const qid = await seedQuestionnaire(projectId);

    const res = await app.inject({
      method: "POST",
      url: "/v1/questionnaires/post-onboarding/responses",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        user_id: "user_42",
        session_id: TEST_SESSION_ID,
        is_complete: true,
        answers: { q_text: "Loving it", q_choice: "yes", q_rating: 5, q_nps: 10 },
        app_version: "1.4.2",
        environment: "ios",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().was_submitted).toBe(true);

    const rows = await dbClient`
      SELECT * FROM questionnaire_responses WHERE questionnaire_id = ${qid}
    `;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.user_id).toBe("user_42");
    expect(row.app_version).toBe("1.4.2");
    expect(row.environment).toBe("ios");
    expect(row.status).toBe("new");
    expect(row.submitted_at).not.toBeNull();
    expect((row.answers as any).q_text).toBe("Loving it");
    expect((row.schema_snapshot as any).questions).toHaveLength(4);
  });

  it("rejects invalid answers (missing required) on final submit", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const res = await app.inject({
      method: "POST",
      url: "/v1/questionnaires/post-onboarding/responses",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        user_id: "user_42",
        is_complete: true,
        answers: { q_text: "Loving it" }, // missing required q_choice
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/q_choice/);
  });

  it("returns 409 already_responded on duplicate final submit by same user", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const submit = async () =>
      app.inject({
        method: "POST",
        url: "/v1/questionnaires/post-onboarding/responses",
        headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: {
          bundle_id: TEST_BUNDLE_ID,
          user_id: "user_42",
          is_complete: true,
          answers: { q_text: "Hi", q_choice: "yes" },
        },
      });

    expect((await submit()).statusCode).toBe(201);
    const second = await submit();
    expect(second.statusCode).toBe(409);
    expect(second.json().reason).toBe("already_responded");
  });

  it("returns 409 globally_dismissed when the user has opted out", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);
    await insertAppUser(projectId, "user_42", {
      properties: { [QUESTIONNAIRES_DISMISSED_PROPERTY]: new Date().toISOString() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/questionnaires/post-onboarding/responses",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        user_id: "user_42",
        is_complete: true,
        answers: { q_text: "Hi", q_choice: "yes" },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe("globally_dismissed");
  });

  it("permits anonymous responses (no user_id) without race-key conflict", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const submit = async () =>
      app.inject({
        method: "POST",
        url: "/v1/questionnaires/post-onboarding/responses",
        headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: {
          bundle_id: TEST_BUNDLE_ID,
          is_complete: true,
          answers: { q_text: "Anon", q_choice: "no" },
        },
      });
    expect((await submit()).statusCode).toBe(201);
    expect((await submit()).statusCode).toBe(201);

    const rows = await dbClient`SELECT id FROM questionnaire_responses WHERE user_id IS NULL`;
    expect(rows.length).toBe(2);
  });
});

describe("POST /v1/questionnaires/:slug/responses — draft lifecycle", () => {
  // Helper that submits a save and returns the parsed body.
  async function save(
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: any }> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/questionnaires/post-onboarding/responses",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, ...payload },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  it("saves a partial answer as a draft (submitted_at null, status=draft, no snapshot)", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    const qid = await seedQuestionnaire(projectId);

    const r = await save({ user_id: "user_42", answers: { q_text: "draft start" } });
    expect(r.statusCode).toBe(201);
    expect(r.body.was_submitted).toBe(false);

    const [row] = await dbClient`SELECT * FROM questionnaire_responses WHERE questionnaire_id = ${qid}`;
    expect(row).toBeDefined();
    expect(row!.submitted_at).toBeNull();
    expect(row!.status).toBe("draft");
    expect(row!.schema_snapshot).toBeNull();
    expect((row!.answers as any).q_text).toBe("draft start");
  });

  it("merges incoming answers on each save (key-level)", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    const qid = await seedQuestionnaire(projectId);

    expect((await save({ user_id: "u", answers: { q_text: "first" } })).statusCode).toBe(201);
    expect((await save({ user_id: "u", answers: { q_choice: "yes" } })).statusCode).toBe(200);
    expect((await save({ user_id: "u", answers: { q_rating: 4 } })).statusCode).toBe(200);

    const rows = await dbClient`SELECT id, answers FROM questionnaire_responses WHERE questionnaire_id = ${qid}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.answers).toEqual({ q_text: "first", q_choice: "yes", q_rating: 4 });
  });

  it("overwrites an existing key when re-saved with a new value", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    expect((await save({ user_id: "u", answers: { q_text: "first attempt" } })).statusCode).toBe(201);
    expect(
      (await save({ user_id: "u", answers: { q_text: "second attempt" } })).statusCode,
    ).toBe(200);

    const rows = await dbClient`SELECT answers FROM questionnaire_responses WHERE user_id = 'u'`;
    expect((rows[0]!.answers as any).q_text).toBe("second attempt");
  });

  it("flips submitted_at on is_complete=true and only fires the notification once", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    // Three partial saves followed by a completion save.
    expect((await save({ user_id: "u", answers: { q_text: "hi" } })).body.was_submitted).toBe(false);
    expect((await save({ user_id: "u", answers: { q_choice: "yes" } })).body.was_submitted).toBe(false);
    expect((await save({ user_id: "u", answers: { q_rating: 4 } })).body.was_submitted).toBe(false);

    const final = await save({
      user_id: "u",
      is_complete: true,
      answers: { q_nps: 9 },
    });
    expect(final.statusCode).toBe(200);
    expect(final.body.was_submitted).toBe(true);

    const rows = await dbClient`SELECT status, submitted_at, schema_snapshot, answers FROM questionnaire_responses WHERE user_id = 'u'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("new");
    expect(rows[0]!.submitted_at).not.toBeNull();
    expect((rows[0]!.schema_snapshot as any).questions).toHaveLength(4);
    // Accumulated answers from every partial save plus the final completion.
    expect(rows[0]!.answers).toEqual({
      q_text: "hi",
      q_choice: "yes",
      q_rating: 4,
      q_nps: 9,
    });

    // A subsequent save call against the submitted row must be refused.
    const after = await save({ user_id: "u", answers: { q_text: "edit" } });
    expect(after.statusCode).toBe(409);
    expect(after.body.reason).toBe("already_responded");
  });

  it("rejects a completion save when required answers are still missing", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    expect((await save({ user_id: "u", answers: { q_text: "hi" } })).statusCode).toBe(201);
    // q_choice is required but never saved.
    const r = await save({
      user_id: "u",
      is_complete: true,
      answers: { q_nps: 5 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toMatch(/q_choice/);

    // Row is still a draft after the failed completion.
    const rows = await dbClient`SELECT submitted_at FROM questionnaire_responses WHERE user_id = 'u'`;
    expect(rows[0]!.submitted_at).toBeNull();
  });

  it("prunes unknown keys at completion when the schema removed a question mid-draft", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    const qid = await seedQuestionnaire(projectId);

    // User saves all four questions as a draft.
    expect(
      (
        await save({
          user_id: "u",
          answers: { q_text: "hi", q_choice: "yes", q_rating: 4, q_nps: 9 },
        })
      ).statusCode,
    ).toBe(201);

    // Editor removes the rating question before the user completes.
    const trimmedSchema: QuestionnaireSchema = {
      version: 1,
      questions: SAMPLE_SCHEMA.questions.filter((q) => q.id !== "q_rating"),
    };
    await dbClient`UPDATE questionnaires SET schema = ${JSON.stringify(trimmedSchema)}::jsonb WHERE id = ${qid}`;

    // Completion succeeds — the stale q_rating answer is pruned.
    const r = await save({
      user_id: "u",
      is_complete: true,
      answers: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.body.was_submitted).toBe(true);

    const rows = await dbClient`SELECT answers, schema_snapshot FROM questionnaire_responses WHERE user_id = 'u'`;
    const stored = rows[0]!.answers as Record<string, unknown>;
    expect(stored).toEqual({ q_text: "hi", q_choice: "yes", q_nps: 9 });
    // Snapshot reflects the live schema at completion time.
    expect(((rows[0]!.schema_snapshot as any).questions as Array<{ id: string }>).map((q) => q.id)).toEqual([
      "q_text",
      "q_choice",
      "q_nps",
    ]);
  });

  it("still validates type/range on partial saves (out-of-range NPS is rejected even mid-draft)", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;
    await seedQuestionnaire(projectId);

    const r = await save({ user_id: "u", answers: { q_nps: 42 } });
    expect(r.statusCode).toBe(400);
  });
});

describe("POST /v1/questionnaires/dismiss", () => {
  it("writes _questionnaires_dismissed_at on app_users.properties", async () => {
    const projectRow = await dbClient`SELECT id FROM projects WHERE slug='test-project'`;
    const projectId = projectRow[0]!.id as string;

    const res = await app.inject({
      method: "POST",
      url: "/v1/questionnaires/dismiss",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, user_id: "user_42" },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().dismissed_at).toBe("string");

    const rows = await dbClient`
      SELECT properties FROM app_users WHERE project_id=${projectId} AND user_id='user_42'
    `;
    expect(rows).toHaveLength(1);
    expect((rows[0]!.properties as any)[QUESTIONNAIRES_DISMISSED_PROPERTY]).toBeDefined();
  });

  it("requires user_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/questionnaires/dismiss",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID },
    });
    expect(res.statusCode).toBe(400);
  });
});
