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

  it("returns eligible:false reason=already_responded after a response exists", async () => {
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
  it("persists a complete response with snapshot and answers", async () => {
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
        answers: { q_text: "Loving it", q_choice: "yes", q_rating: 5, q_nps: 10 },
        app_version: "1.4.2",
        environment: "ios",
      },
    });
    expect(res.statusCode).toBe(201);

    const rows = await dbClient`
      SELECT * FROM questionnaire_responses WHERE questionnaire_id = ${qid}
    `;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.user_id).toBe("user_42");
    expect(row.app_version).toBe("1.4.2");
    expect(row.environment).toBe("ios");
    expect(row.status).toBe("new");
    expect((row.answers as any).q_text).toBe("Loving it");
    expect((row.schema_snapshot as any).questions).toHaveLength(4);
  });

  it("rejects invalid answers (missing required)", async () => {
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
        answers: { q_text: "Loving it" }, // missing required q_choice
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/q_choice/);
  });

  it("returns 409 already_responded on duplicate submit by same user", async () => {
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
          answers: { q_text: "Anon", q_choice: "no" },
        },
      });
    expect((await submit()).statusCode).toBe(201);
    expect((await submit()).statusCode).toBe(201);

    const rows = await dbClient`SELECT id FROM questionnaire_responses WHERE user_id IS NULL`;
    expect(rows.length).toBe(2);
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
