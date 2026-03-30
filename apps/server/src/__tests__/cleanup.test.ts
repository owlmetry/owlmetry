import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { cleanupSoftDeletedResources } from "@owlmetry/db";
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
