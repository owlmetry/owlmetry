import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { issueNotifyHandler } from "../jobs/issue-notify.js";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createUserAndGetToken,
  addTeamMember,
  makeJobContext,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let teamId: string;
let projectId: string;
let appId: string;
let ownerUserId: string;

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
  teamId = result.teamId;
  const [proj] = await dbClient`SELECT id FROM projects WHERE team_id = ${teamId}`;
  projectId = proj.id;
  const [appRow] = await dbClient`SELECT id FROM apps WHERE project_id = ${projectId}`;
  appId = appRow.id;
  const [owner] = await dbClient`SELECT id FROM users WHERE email = 'test@owlmetry.com'`;
  ownerUserId = owner.id;
});

async function makeProjectEligible() {
  // Switch to hourly + back-date so the gate passes.
  await dbClient`
    UPDATE projects
    SET issue_alert_frequency = 'hourly',
        created_at = NOW() - INTERVAL '2 hours'
    WHERE id = ${projectId}
  `;
}

async function seedQualifyingIssue() {
  await dbClient`
    INSERT INTO issues (project_id, app_id, status, title, occurrence_count, unique_user_count, is_dev, first_seen_at, last_seen_at)
    VALUES (
      ${projectId}, ${appId}, 'new',
      'TypeError: cannot read property foo',
      5, 3, false,
      NOW() - INTERVAL '30 minutes', NOW()
    )
  `;
}

describe("issue_notify producer", () => {
  it("creates one inbox row per team member with project_id in data", async () => {
    await makeProjectEligible();
    await seedQualifyingIssue();
    const u2 = await createUserAndGetToken(app, "member-a@owlmetry.com");
    const u3 = await createUserAndGetToken(app, "member-b@owlmetry.com");
    await addTeamMember(teamId, u2.userId, "member");
    await addTeamMember(teamId, u3.userId, "admin");

    const handler = issueNotifyHandler(app.notificationDispatcher);
    await handler(makeJobContext(), {});

    const inbox = await dbClient`
      SELECT user_id, type, team_id, data FROM notifications ORDER BY user_id
    `;
    expect(inbox).toHaveLength(3);
    expect(inbox.every((r) => r.type === "issue.digest")).toBe(true);
    expect(inbox.every((r) => r.team_id === teamId)).toBe(true);
    expect(inbox.every((r) => (r.data as Record<string, unknown>).project_id === projectId)).toBe(true);
  });

  it("respects per-user email-off preference", async () => {
    await makeProjectEligible();
    await seedQualifyingIssue();
    const u2 = await createUserAndGetToken(app, "muted@owlmetry.com");
    await addTeamMember(teamId, u2.userId, "member");
    await dbClient`
      UPDATE users
      SET preferences = '{"notifications":{"types":{"issue.digest":{"email":false}}}}'::jsonb
      WHERE id = ${u2.userId}
    `;

    const handler = issueNotifyHandler(app.notificationDispatcher);
    await handler(makeJobContext(), {});

    const emailDeliveries = await dbClient`
      SELECT nd.id FROM notification_deliveries nd
      JOIN notifications n ON n.id = nd.notification_id
      WHERE nd.channel = 'email' AND n.user_id = ${u2.userId}
    `;
    expect(emailDeliveries).toHaveLength(0);
    const inApp = await dbClient`
      SELECT nd.id FROM notification_deliveries nd
      JOIN notifications n ON n.id = nd.notification_id
      WHERE nd.channel = 'in_app' AND n.user_id = ${u2.userId}
    `;
    expect(inApp).toHaveLength(1);
  });

  it("skips when no qualifying issues", async () => {
    await makeProjectEligible();
    // No issues seeded.
    const handler = issueNotifyHandler(app.notificationDispatcher);
    await handler(makeJobContext(), {});
    const inbox = await dbClient`SELECT id FROM notifications`;
    expect(inbox).toHaveLength(0);
  });

  it("skips when project frequency is 'none'", async () => {
    await dbClient`UPDATE projects SET issue_alert_frequency = 'none' WHERE id = ${projectId}`;
    await seedQualifyingIssue();
    const handler = issueNotifyHandler(app.notificationDispatcher);
    await handler(makeJobContext(), {});
    const inbox = await dbClient`SELECT id FROM notifications`;
    expect(inbox).toHaveLength(0);
  });
});
