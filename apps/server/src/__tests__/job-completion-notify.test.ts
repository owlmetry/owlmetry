import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createUserAndGetToken,
  addTeamMember,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let teamId: string;
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
  const [owner] = await dbClient`SELECT id FROM users WHERE email = 'test@owlmetry.com'`;
  ownerUserId = owner.id;
});

describe("job completion notification", () => {
  it("manual job with notify=true sends inbox row only to the triggering user", async () => {
    const u2 = await createUserAndGetToken(app, "other@owlmetry.com");
    await addTeamMember(teamId, u2.userId, "member");

    await app.jobRunner.trigger("test_job", {
      triggeredBy: `manual:user:${ownerUserId}`,
      teamId,
      notify: true,
    });

    // Wait for job execution + dispatcher fan-out.
    await new Promise((r) => setTimeout(r, 200));

    const inbox = await dbClient`
      SELECT user_id, type FROM notifications WHERE type = 'job.completed'
    `;
    expect(inbox).toHaveLength(1);
    expect(inbox[0].user_id).toBe(ownerUserId);
  });

  it("manual job with notify=false does not create a notification", async () => {
    await app.jobRunner.trigger("test_job", {
      triggeredBy: `manual:user:${ownerUserId}`,
      teamId,
      notify: false,
    });
    await new Promise((r) => setTimeout(r, 200));
    const inbox = await dbClient`SELECT id FROM notifications WHERE type = 'job.completed'`;
    expect(inbox).toHaveLength(0);
  });
});
