import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createAgentKey,
  TEST_CLIENT_KEY,
  TEST_BUNDLE_ID,
  TEST_DB_URL,
} from "./setup.js";
import type { QuestionnaireSchema } from "@owlmetry/shared";

let app: FastifyInstance;
let token: string;
let teamId: string;
let projectId: string;
let dbClient: postgres.Sql;

beforeAll(async () => {
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await dbClient.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
  const result = await getTokenAndTeamId(app);
  token = result.token;
  teamId = result.teamId;
  const projRes = await app.inject({
    method: "GET",
    url: "/v1/projects",
    headers: { Authorization: `Bearer ${token}` },
  });
  projectId = JSON.parse(projRes.body).projects[0].id;
});

const SAMPLE_SCHEMA: QuestionnaireSchema = {
  version: 1,
  questions: [
    { id: "q_text", type: "text", title: "Tell us", required: true, multiline: true },
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
    {
      id: "q_multi",
      type: "multi_choice",
      title: "Pick any",
      required: false,
      options: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Bravo" },
        { id: "c", label: "Charlie" },
      ],
    },
    { id: "q_rating", type: "rating", title: "Rate", required: false, scale: 5 },
    { id: "q_nps", type: "nps", title: "Recommend", required: false },
  ],
};

async function createQuestionnaire(slug = "survey") {
  const res = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/questionnaires`,
    headers: { Authorization: `Bearer ${token}` },
    payload: { slug, name: "Survey", schema: SAMPLE_SCHEMA },
  });
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

async function ingestResponse(
  slug: string,
  userId: string,
  answers: Record<string, unknown>,
) {
  const res = await app.inject({
    method: "POST",
    url: `/v1/questionnaires/${slug}/responses`,
    headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    // Dashboard-management tests want a fully-submitted row so analytics
    // and detail surfaces have schema_snapshot + submitted_at populated.
    payload: { bundle_id: TEST_BUNDLE_ID, user_id: userId, is_complete: true, answers },
  });
  if (res.statusCode !== 201) throw new Error(`ingest failed: ${res.statusCode} ${res.body}`);
  return res.json().id as string;
}

describe("POST /v1/projects/:projectId/questionnaires", () => {
  it("creates a questionnaire", async () => {
    const body = await createQuestionnaire();
    expect(body.slug).toBe("survey");
    expect(body.is_active).toBe(true);
    expect(body.response_count).toBe(0);
  });

  it("rejects duplicate slug in same project", async () => {
    await createQuestionnaire("dup");
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { slug: "dup", name: "Survey 2", schema: SAMPLE_SCHEMA },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects malformed schema", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { slug: "x", name: "X", schema: { version: 1, questions: [] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects bad slug format", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { slug: "Bad Slug!", name: "X", schema: SAMPLE_SCHEMA },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/projects/:projectId/questionnaires", () => {
  it("lists questionnaires with response counts", async () => {
    const a = await createQuestionnaire("a");
    await createQuestionnaire("b");
    await ingestResponse("a", "u1", { q_text: "Hi", q_choice: "yes" });
    await ingestResponse("a", "u2", { q_text: "Hey", q_choice: "no" });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.questionnaires).toHaveLength(2);
    const aRow = body.questionnaires.find((q: any) => q.slug === "a");
    expect(aRow.response_count).toBe(2);
    expect(aRow.last_response_at).toBeTruthy();
  });
});

describe("PATCH /v1/projects/:projectId/questionnaires/:id", () => {
  it("blocks slug changes", async () => {
    const q = await createQuestionnaire();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/questionnaires/${q.id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { slug: "new-slug" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates name + is_active", async () => {
    const q = await createQuestionnaire();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/questionnaires/${q.id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Renamed", is_active: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed");
    expect(res.json().is_active).toBe(false);
  });
});

describe("DELETE /v1/projects/:projectId/questionnaires/:id", () => {
  it("agent keys get 403", async () => {
    const q = await createQuestionnaire();
    const agentKey = await createAgentKey(app, token, teamId, [
      "questionnaires:read",
      "questionnaires:write",
    ]);
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/questionnaires/${q.id}`,
      headers: { Authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("user soft-deletes the questionnaire", async () => {
    const q = await createQuestionnaire();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/questionnaires/${q.id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = await dbClient`SELECT deleted_at, is_active FROM questionnaires WHERE id=${q.id}`;
    expect(rows[0]!.deleted_at).toBeTruthy();
    expect(rows[0]!.is_active).toBe(false);
  });

  it("detail surfaces response_count (incl. drafts) and submitted_count separately", async () => {
    const q = await createQuestionnaire();
    // One submitted, two drafts.
    await ingestResponse("survey", "submit-u", { q_text: "Hi", q_choice: "yes" });
    await app.inject({
      method: "POST",
      url: `/v1/questionnaires/survey/responses`,
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, user_id: "draft-u1", answers: { q_text: "wip" } },
    });
    await app.inject({
      method: "POST",
      url: `/v1/questionnaires/survey/responses`,
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, user_id: "draft-u2", answers: { q_choice: "no" } },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires/${q.id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().response_count).toBe(3);
    expect(detail.json().submitted_count).toBe(1);
  });
});

describe("Responses + comments", () => {
  it("lists responses + drills into detail with comments", async () => {
    await createQuestionnaire();
    const r1 = await ingestResponse("survey", "u1", {
      q_text: "Hi",
      q_choice: "yes",
      q_rating: 4,
    });

    const q = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const qid = q.json().questionnaires[0].id;

    const list = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/responses`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().responses).toHaveLength(1);

    // Add comment
    const cmt = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/responses/${r1}/comments`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "Cool insight" },
    });
    expect(cmt.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/responses/${r1}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().comments).toHaveLength(1);
    expect(detail.json().comments[0].body).toBe("Cool insight");
    expect(detail.json().schema_snapshot.questions).toHaveLength(5);
    expect(detail.json().is_complete).toBe(true);
    expect(detail.json().submitted_at).toBeTruthy();
  });

  it("response list includes drafts by default, can be filtered to submitted_only", async () => {
    await createQuestionnaire();
    // Submitted user.
    await ingestResponse("survey", "u-submit", { q_text: "Hi", q_choice: "yes" });
    // Draft user.
    await app.inject({
      method: "POST",
      url: `/v1/questionnaires/survey/responses`,
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, user_id: "u-draft", answers: { q_text: "wip" } },
    });

    const q = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const qid = q.json().questionnaires[0].id;

    const listAll = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/responses`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listAll.json().responses).toHaveLength(2);
    const draftRow = listAll.json().responses.find((r: any) => r.user_id === "u-draft");
    expect(draftRow.is_complete).toBe(false);
    expect(draftRow.submitted_at).toBeNull();
    expect(draftRow.status).toBe("draft");
    expect(draftRow.schema_snapshot).toBeNull();

    const listSubmittedOnly = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/responses?submitted_only=true`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listSubmittedOnly.json().responses).toHaveLength(1);
    expect(listSubmittedOnly.json().responses[0].user_id).toBe("u-submit");
  });

  it("analytics counts drafts in per-question rollups by default", async () => {
    await createQuestionnaire();
    // Submitted user fills everything.
    await ingestResponse("survey", "u-submit", {
      q_text: "Hi",
      q_choice: "yes",
      q_rating: 4,
    });
    // Draft user fills only q_text.
    await app.inject({
      method: "POST",
      url: `/v1/questionnaires/survey/responses`,
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, user_id: "u-draft", answers: { q_text: "wip" } },
    });

    const q = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const qid = q.json().questionnaires[0].id;

    const all = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/analytics`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(all.json().total_responses).toBe(2);
    expect(all.json().submitted_count).toBe(1);
    const textQ = all.json().questions.find((q: any) => q.id === "q_text");
    expect(textQ.total_answered).toBe(2); // both submitted + draft answered
    const choiceQ = all.json().questions.find((q: any) => q.id === "q_choice");
    expect(choiceQ.total_answered).toBe(1); // only the submitted

    const submittedOnly = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/analytics?submitted_only=true`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(submittedOnly.json().total_responses).toBe(1);
    expect(submittedOnly.json().submitted_count).toBe(1);
    const textQOnly = submittedOnly.json().questions.find((q: any) => q.id === "q_text");
    expect(textQOnly.total_answered).toBe(1);
  });

  it("updates response status", async () => {
    await createQuestionnaire();
    const r1 = await ingestResponse("survey", "u1", { q_text: "Hi", q_choice: "yes" });
    const q = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const qid = q.json().questionnaires[0].id;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/responses/${r1}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { status: "addressed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("addressed");
  });
});

describe("Analytics", () => {
  it("aggregates choice, rating, NPS distributions", async () => {
    await createQuestionnaire();
    await ingestResponse("survey", "u1", { q_text: "T1", q_choice: "yes", q_rating: 5, q_nps: 10 });
    await ingestResponse("survey", "u2", { q_text: "T2", q_choice: "yes", q_rating: 4, q_nps: 9 });
    await ingestResponse("survey", "u3", { q_text: "T3", q_choice: "no", q_rating: 1, q_nps: 3 });
    await ingestResponse("survey", "u4", {
      q_text: "M",
      q_choice: "yes",
      q_multi: ["a", "c"],
    });

    const q = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const qid = q.json().questionnaires[0].id;

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/questionnaires/${qid}/analytics`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_responses).toBe(4);

    const choice = body.questions.find((q: any) => q.id === "q_choice");
    expect(choice.type).toBe("single_choice");
    expect(choice.choices.find((c: any) => c.id === "yes").count).toBe(3);
    expect(choice.choices.find((c: any) => c.id === "no").count).toBe(1);

    const multi = body.questions.find((q: any) => q.id === "q_multi");
    expect(multi.choices.find((c: any) => c.id === "a").count).toBe(1);
    expect(multi.choices.find((c: any) => c.id === "c").count).toBe(1);
    expect(multi.choices.find((c: any) => c.id === "b").count).toBe(0);
    expect(multi.total_answered).toBe(1);

    const rating = body.questions.find((q: any) => q.id === "q_rating");
    expect(rating.type).toBe("rating");
    expect(rating.total_answered).toBe(3);
    expect(rating.average).toBeCloseTo((5 + 4 + 1) / 3, 2);

    const nps = body.questions.find((q: any) => q.id === "q_nps");
    expect(nps.type).toBe("nps");
    expect(nps.promoters).toBe(2);
    expect(nps.detractors).toBe(1);
    expect(nps.passives).toBe(0);

    const text = body.questions.find((q: any) => q.id === "q_text");
    expect(text.type).toBe("text");
    expect(text.recent_answers.length).toBe(4);
  });
});
