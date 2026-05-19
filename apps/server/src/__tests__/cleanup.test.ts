import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { cleanupSoftDeletedResources } from "@owlmetry/db";
import { INTEGRATION_PROVIDER_IDS } from "@owlmetry/shared";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  TEST_DB_URL,
  TEST_USER,
} from "./setup.js";

let app: FastifyInstance;
let testData: { userId: string; teamId: string; projectId: string; appId: string };

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
});

afterAll(async () => {
  await app.close();
});

describe("cleanupSoftDeletedResources", () => {
  it("does nothing when no resources are past the 7-day cutoff", async () => {
    const token = await getToken(app);

    // Soft-delete a project (just now — within 7 days)
    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const client = postgres(TEST_DB_URL, { max: 1 });
    const result = await cleanupSoftDeletedResources(client);
    await client.end();

    // Everything should be zero — nothing past cutoff
    expect(result.projects).toBe(0);
    expect(result.apps).toBe(0);
    expect(result.apiKeys).toBe(0);
  });

  it("hard-deletes resources past the 7-day cutoff", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    // Backdate soft-delete to 8 days ago
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    // Soft-delete project, app, and api_keys with backdated timestamp
    await client`UPDATE projects SET deleted_at = ${eightDaysAgo} WHERE id = ${testData.projectId}`;
    await client`UPDATE apps SET deleted_at = ${eightDaysAgo} WHERE project_id = ${testData.projectId}`;
    await client`UPDATE api_keys SET deleted_at = ${eightDaysAgo} WHERE app_id = ${testData.appId}`;

    const result = await cleanupSoftDeletedResources(client);

    // Project, app, and keys should be hard-deleted
    expect(result.projects).toBeGreaterThanOrEqual(1);
    expect(result.apps).toBeGreaterThanOrEqual(1);
    expect(result.apiKeys).toBeGreaterThanOrEqual(1);

    // Verify rows are actually gone
    const projects = await client`SELECT id FROM projects WHERE id = ${testData.projectId}`;
    expect(projects).toHaveLength(0);

    const apps = await client`SELECT id FROM apps WHERE id = ${testData.appId}`;
    expect(apps).toHaveLength(0);

    await client.end();
  });

  it("logs event deletions to the event_deletions audit table", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    // Insert an event for the test app
    await client.unsafe(
      `INSERT INTO events (app_id, level, message, session_id, environment, timestamp, received_at)
       VALUES ($1, 'info', 'will be cleaned up', $2, 'ios', NOW(), NOW())`,
      [testData.appId, crypto.randomUUID()]
    );

    // Backdate soft-delete to 8 days ago
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    await client`UPDATE projects SET deleted_at = ${eightDaysAgo} WHERE id = ${testData.projectId}`;
    await client`UPDATE apps SET deleted_at = ${eightDaysAgo} WHERE project_id = ${testData.projectId}`;
    await client`UPDATE api_keys SET deleted_at = ${eightDaysAgo} WHERE app_id = ${testData.appId}`;

    const result = await cleanupSoftDeletedResources(client);
    expect(result.events).toBeGreaterThanOrEqual(1);

    // Verify audit rows were created
    const auditRows = await client`SELECT * FROM event_deletions WHERE reason = 'soft_delete_cleanup'`;
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const eventsAudit = auditRows.find((r) => r.table_name === "events");
    expect(eventsAudit).toBeDefined();
    expect(eventsAudit!.deleted_count).toBeGreaterThanOrEqual(1);

    await client.end();
  });

  it("row-level sweeps feedback/issue/questionnaire/integration soft-deletes past cutoff", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // feedback (parent) + feedback_comments (child) — one of each, past & recent
    const [feedbackOld] = await client`
      INSERT INTO feedback (app_id, project_id, message, deleted_at)
      VALUES (${testData.appId}, ${testData.projectId}, 'old', ${eightDaysAgo})
      RETURNING id
    `;
    const [feedbackRecent] = await client`
      INSERT INTO feedback (app_id, project_id, message, deleted_at)
      VALUES (${testData.appId}, ${testData.projectId}, 'recent', ${oneDayAgo})
      RETURNING id
    `;
    await client`
      INSERT INTO feedback_comments (feedback_id, author_type, author_id, author_name, body, deleted_at)
      VALUES (${feedbackRecent.id}, 'user', ${testData.userId}, 'Tester', 'old comment', ${eightDaysAgo})
    `;
    await client`
      INSERT INTO feedback_comments (feedback_id, author_type, author_id, author_name, body, deleted_at)
      VALUES (${feedbackRecent.id}, 'user', ${testData.userId}, 'Tester', 'recent comment', ${oneDayAgo})
    `;

    // issue + issue_comments
    const now = new Date();
    const [issue] = await client`
      INSERT INTO issues (app_id, project_id, title, first_seen_at, last_seen_at)
      VALUES (${testData.appId}, ${testData.projectId}, 'boom', ${now}, ${now})
      RETURNING id
    `;
    await client`
      INSERT INTO issue_comments (issue_id, author_type, author_id, author_name, body, deleted_at)
      VALUES (${issue.id}, 'user', ${testData.userId}, 'Tester', 'old', ${eightDaysAgo})
    `;
    await client`
      INSERT INTO issue_comments (issue_id, author_type, author_id, author_name, body, deleted_at)
      VALUES (${issue.id}, 'user', ${testData.userId}, 'Tester', 'recent', ${oneDayAgo})
    `;

    // questionnaire + responses + response comments. The "old" questionnaire
    // has no responses, so it's eligible for parent delete. The "recent" one
    // has a live response, so it should survive even if it were past cutoff.
    const minimalSchema = JSON.stringify({ version: 1, questions: [] });
    const [questionnaireOrphan] = await client`
      INSERT INTO questionnaires (project_id, slug, name, schema, deleted_at)
      VALUES (${testData.projectId}, 'q-orphan', 'Orphan', ${minimalSchema}::jsonb, ${eightDaysAgo})
      RETURNING id
    `;
    const [questionnaireLive] = await client`
      INSERT INTO questionnaires (project_id, slug, name, schema)
      VALUES (${testData.projectId}, 'q-live', 'Live', ${minimalSchema}::jsonb)
      RETURNING id
    `;
    const emptyAnswers = JSON.stringify({});
    const [responseOld] = await client`
      INSERT INTO questionnaire_responses (questionnaire_id, slug, app_id, project_id, answers, deleted_at)
      VALUES (${questionnaireLive.id}, 'q-live', ${testData.appId}, ${testData.projectId}, ${emptyAnswers}::jsonb, ${eightDaysAgo})
      RETURNING id
    `;
    const [responseRecent] = await client`
      INSERT INTO questionnaire_responses (questionnaire_id, slug, app_id, project_id, answers)
      VALUES (${questionnaireLive.id}, 'q-live', ${testData.appId}, ${testData.projectId}, ${emptyAnswers}::jsonb)
      RETURNING id
    `;
    await client`
      INSERT INTO questionnaire_response_comments (questionnaire_response_id, author_type, author_id, author_name, body, deleted_at)
      VALUES (${responseRecent.id}, 'user', ${testData.userId}, 'Tester', 'old', ${eightDaysAgo})
    `;
    await client`
      INSERT INTO questionnaire_response_comments (questionnaire_response_id, author_type, author_id, author_name, body, deleted_at)
      VALUES (${responseRecent.id}, 'user', ${testData.userId}, 'Tester', 'recent', ${oneDayAgo})
    `;

    // project_integrations
    const integrationConfig = JSON.stringify({ webhook_secret: "abc" });
    await client`
      INSERT INTO project_integrations (project_id, provider, config, deleted_at)
      VALUES (${testData.projectId}, ${INTEGRATION_PROVIDER_IDS.REVENUECAT}, ${integrationConfig}::jsonb, ${eightDaysAgo})
    `;
    await client`
      INSERT INTO project_integrations (project_id, provider, config, deleted_at)
      VALUES (${testData.projectId}, ${INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS}, ${integrationConfig}::jsonb, ${oneDayAgo})
    `;

    const result = await cleanupSoftDeletedResources(client);

    expect(result.feedback).toBe(1);
    expect(result.feedbackComments).toBe(1);
    expect(result.issueComments).toBe(1);
    expect(result.questionnaireResponses).toBe(1);
    expect(result.questionnaireResponseComments).toBe(1);
    expect(result.questionnaires).toBe(1);
    expect(result.projectIntegrations).toBe(1);

    // Past-cutoff rows are gone
    const oldFeedback = await client`SELECT id FROM feedback WHERE id = ${feedbackOld.id}`;
    expect(oldFeedback).toHaveLength(0);
    const oldResponse = await client`SELECT id FROM questionnaire_responses WHERE id = ${responseOld.id}`;
    expect(oldResponse).toHaveLength(0);
    const orphanQ = await client`SELECT id FROM questionnaires WHERE id = ${questionnaireOrphan.id}`;
    expect(orphanQ).toHaveLength(0);

    // Recent rows survive
    const recentFeedback = await client`SELECT id FROM feedback WHERE id = ${feedbackRecent.id}`;
    expect(recentFeedback).toHaveLength(1);
    const recentResponse = await client`SELECT id FROM questionnaire_responses WHERE id = ${responseRecent.id}`;
    expect(recentResponse).toHaveLength(1);
    const liveQ = await client`SELECT id FROM questionnaires WHERE id = ${questionnaireLive.id}`;
    expect(liveQ).toHaveLength(1);

    await client.end();
  });

  it("preserves a soft-deleted questionnaire while any responses remain", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    // Soft-deleted questionnaire past cutoff, BUT a response (also soft-deleted
    // past cutoff) still references it. The response gets swept first in Step 6;
    // the parent only sweeps when no responses remain.
    const minimalSchema = JSON.stringify({ version: 1, questions: [] });
    const [q] = await client`
      INSERT INTO questionnaires (project_id, slug, name, schema, deleted_at)
      VALUES (${testData.projectId}, 'q-with-survivor', 'Has Survivor', ${minimalSchema}::jsonb, ${eightDaysAgo})
      RETURNING id
    `;
    // A response within the window — keeps parent alive for now.
    const emptyAnswers = JSON.stringify({});
    const [response] = await client`
      INSERT INTO questionnaire_responses (questionnaire_id, slug, app_id, project_id, answers)
      VALUES (${q.id}, 'q-with-survivor', ${testData.appId}, ${testData.projectId}, ${emptyAnswers}::jsonb)
      RETURNING id
    `;

    const firstRun = await cleanupSoftDeletedResources(client);
    expect(firstRun.questionnaires).toBe(0);
    expect(firstRun.questionnaireResponses).toBe(0);

    const stillThere = await client`SELECT id FROM questionnaires WHERE id = ${q.id}`;
    expect(stillThere).toHaveLength(1);

    // Now soft-delete the response and backdate it. Next run sweeps the
    // response (Step 6), then the parent (Step 7) since NOT EXISTS clears.
    await client`UPDATE questionnaire_responses SET deleted_at = ${eightDaysAgo} WHERE id = ${response.id}`;

    const secondRun = await cleanupSoftDeletedResources(client);
    expect(secondRun.questionnaireResponses).toBe(1);
    expect(secondRun.questionnaires).toBe(1);

    const gone = await client`SELECT id FROM questionnaires WHERE id = ${q.id}`;
    expect(gone).toHaveLength(0);

    await client.end();
  });

  it("hard-deletes soft-deleted team and all its children after cutoff", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    // Create second team so user has >1
    await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Backup Team", slug: "backup-team" },
    });
    const { token: freshToken } = await getTokenAndTeamId(app);

    // Delete the team (soft-delete)
    await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${freshToken}` },
    });

    // Backdate the soft-delete to 8 days ago
    const client = postgres(TEST_DB_URL, { max: 1 });
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    await client`UPDATE teams SET deleted_at = ${eightDaysAgo} WHERE id = ${teamId}`;
    await client`UPDATE projects SET deleted_at = ${eightDaysAgo} WHERE team_id = ${teamId}`;
    await client`UPDATE apps SET deleted_at = ${eightDaysAgo} WHERE team_id = ${teamId}`;
    await client`UPDATE api_keys SET deleted_at = ${eightDaysAgo} WHERE team_id = ${teamId}`;

    const result = await cleanupSoftDeletedResources(client);

    expect(result.teams).toBe(1);
    expect(result.projects).toBeGreaterThanOrEqual(1);
    expect(result.apps).toBeGreaterThanOrEqual(1);

    // Verify team is gone
    const teams = await client`SELECT id FROM teams WHERE id = ${teamId}`;
    expect(teams).toHaveLength(0);

    await client.end();
  });
});
