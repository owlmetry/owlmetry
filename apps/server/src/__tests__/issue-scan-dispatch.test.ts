import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { issueScanHandler } from "../jobs/issue-scan.js";
import type { JobContext } from "../services/job-runner.js";
import { createDatabaseConnection } from "@owlmetry/db";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  TEST_CLIENT_KEY,
  TEST_SESSION_ID,
  TEST_BUNDLE_ID,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let teamId: string;
let projectId: string;
let appId: string;

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
});

function makeJobContext(): JobContext {
  return {
    runId: "test-run",
    db: createDatabaseConnection(TEST_DB_URL),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    isCancelled: () => false,
    updateProgress: async () => {},
    createClient: () => postgres(TEST_DB_URL, { max: 1 }),
  };
}

async function ingestErrors(events: Array<{
  message: string;
  session_id?: string;
  is_dev?: boolean;
  app_version?: string;
  source_module?: string;
}>) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: {
      bundle_id: TEST_BUNDLE_ID,
      events: events.map((e) => ({
        level: "error",
        session_id: e.session_id ?? TEST_SESSION_ID,
        ...e,
      })),
    },
  });
  expect(res.statusCode).toBe(200);
}

describe("issue_scan → issue.new dispatch", () => {
  it("enqueues exactly one issue.new notification per team for prod errors", async () => {
    await ingestErrors([{ message: "TypeError: oops in handleClick" }]);

    const handler = issueScanHandler(app.notificationDispatcher);
    const result = await handler(makeJobContext(), {});
    expect(result.issues_created).toBe(1);
    expect(result.issue_new_notifications_sent).toBe(1);

    const inbox = await dbClient`
      SELECT user_id, type, team_id, title, body, data FROM notifications
      WHERE type = 'issue.new' ORDER BY created_at DESC
    `;
    expect(inbox).toHaveLength(1);
    expect(inbox[0].team_id).toBe(teamId);
    expect(inbox[0].title).toBe("1 new issue");
    const data = inbox[0].data as { counts: { new: number; regressed: number } };
    expect(data.counts).toEqual({ new: 1, regressed: 0 });
  });

  it("does not push for dev-only errors", async () => {
    await ingestErrors([{ message: "Dev-only crash", is_dev: true }]);

    const handler = issueScanHandler(app.notificationDispatcher);
    const result = await handler(makeJobContext(), {});
    expect(result.issues_created).toBe(1);
    expect(result.issue_new_notifications_sent).toBe(0);

    const inbox = await dbClient`SELECT id FROM notifications WHERE type = 'issue.new'`;
    expect(inbox).toHaveLength(0);
  });

  it("does not dispatch when scan creates zero issues", async () => {
    const handler = issueScanHandler(app.notificationDispatcher);
    const result = await handler(makeJobContext(), {});
    expect(result.issues_created).toBe(0);
    expect(result.issue_new_notifications_sent).toBe(0);

    const inbox = await dbClient`SELECT id FROM notifications WHERE type = 'issue.new'`;
    expect(inbox).toHaveLength(0);
  });

  it("titles a regression as '1 regressed' with no new issues", async () => {
    // Seed a resolved issue at version 1.0.0, then ingest a 1.1.0 error matching it.
    const [resolved] = await dbClient<{ id: string }[]>`
      INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, resolved_at_version, first_seen_at, last_seen_at)
      VALUES (${appId}, ${projectId}, 'resolved', 'Old bug returns', 'OldModule', false, '1.0.0', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days')
      RETURNING id
    `;
    const fingerprint = await import("@owlmetry/shared").then((m) =>
      m.generateIssueFingerprint("Old bug returns", "OldModule")
    );
    await dbClient`
      INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id)
      VALUES (${fingerprint}, ${appId}, false, ${resolved.id})
    `;
    await ingestErrors([{ message: "Old bug returns", source_module: "OldModule", app_version: "1.1.0" }]);

    const handler = issueScanHandler(app.notificationDispatcher);
    const result = await handler(makeJobContext(), {});
    expect(result.issues_regressed).toBe(1);
    expect(result.issue_new_notifications_sent).toBe(1);

    const [notif] = await dbClient`
      SELECT title, data FROM notifications WHERE type = 'issue.new'
    `;
    expect(notif.title).toBe("1 regressed");
    const data = notif.data as { counts: { new: number; regressed: number } };
    expect(data.counts).toEqual({ new: 0, regressed: 1 });
  });

  it("combines new + regressed into one notification with both counts", async () => {
    // Resolved issue (will regress)
    const [resolved] = await dbClient<{ id: string }[]>`
      INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, resolved_at_version, first_seen_at, last_seen_at)
      VALUES (${appId}, ${projectId}, 'resolved', 'Re-emerged', 'OldMod', false, '1.0.0', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days')
      RETURNING id
    `;
    const fingerprint = await import("@owlmetry/shared").then((m) =>
      m.generateIssueFingerprint("Re-emerged", "OldMod")
    );
    await dbClient`
      INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id)
      VALUES (${fingerprint}, ${appId}, false, ${resolved.id})
    `;

    await ingestErrors([
      { message: "Re-emerged", source_module: "OldMod", app_version: "1.1.0", session_id: "00000000-0000-0000-0000-aaa000000001" },
      { message: "Brand new bug", source_module: "NewMod", session_id: "00000000-0000-0000-0000-aaa000000002" },
    ]);

    const handler = issueScanHandler(app.notificationDispatcher);
    const result = await handler(makeJobContext(), {});
    expect(result.issues_created).toBe(1);
    expect(result.issues_regressed).toBe(1);
    expect(result.issue_new_notifications_sent).toBe(1);

    const [notif] = await dbClient`
      SELECT title, body, data FROM notifications WHERE type = 'issue.new'
    `;
    expect(notif.title).toBe("1 new issue, 1 regressed");
    expect(notif.body).toContain("🆕 Brand new bug");
    expect(notif.body).toContain("🔄 Re-emerged");
  });
});
