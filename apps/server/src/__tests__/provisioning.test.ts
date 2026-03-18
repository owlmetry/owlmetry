import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createUserAndGetToken,
  testEmailService,
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

/** Send a code and return it (via TestEmailService). */
async function sendCode(email: string): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/v1/auth/send-code",
    payload: { email },
  });
  return testEmailService.lastCode;
}

describe("POST /v1/auth/agent-login", () => {
  it("verifies code and returns agent key for new user", async () => {
    const code = await sendCode("newagent@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: "newagent@owlmetry.com", code },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.api_key).toMatch(/^owl_agent_/);
    expect(body.team.name).toBe("Newagent's Team");
    expect(body.is_new_setup).toBe(true);
    expect(body.project.name).toBe("My Project");
    expect(body.app.name).toBe("My App");
    expect(body.app.platform).toBe("backend");
  });

  it("verifies code and returns agent key for existing user", async () => {
    const code = await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.api_key).toMatch(/^owl_agent_/);
    expect(body.team.id).toBe(testData.teamId);
    expect(body.is_new_setup).toBe(false);
    expect(body.project).toBeNull();
    expect(body.app).toBeNull();
  });

  it("returned agent key works for API calls", async () => {
    const code = await sendCode("apitest@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: "apitest@owlmetry.com", code },
    });

    const agentKey = res.json().api_key;

    const projRes = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(projRes.statusCode).toBe(200);
    expect(projRes.json().projects).toHaveLength(1);
    expect(projRes.json().projects[0].name).toBe("My Project");
  });

  it("rejects invalid code", async () => {
    await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code: "000000" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects missing fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email },
    });

    expect(res.statusCode).toBe(400);
  });

  it("requires team_id when user has multiple teams", async () => {
    // Create user and add a second team
    const { token } = await getTokenAndTeamId(app);
    await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Second Team", slug: "second-team" },
    });

    const code = await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/team_id/i);
    expect(res.json().teams).toHaveLength(2);
  });

  it("provisions for specific team when team_id provided", async () => {
    const { token } = await getTokenAndTeamId(app);
    const teamRes = await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Second Team", slug: "second-team" },
    });
    const secondTeamId = teamRes.json().id;

    const code = await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code, team_id: secondTeamId },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().team.id).toBe(secondTeamId);
    expect(res.json().is_new_setup).toBe(true);
  });

  it("rejects non-member team_id", async () => {
    const other = await createUserAndGetToken(app, "other@owlmetry.com");
    const code = await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code, team_id: other.teamId },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("Full CLI agent flow (end-to-end)", () => {
  it("send-code → agent-login for new user", async () => {
    // Step 1: Send code
    const sendRes = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "cliuser@owlmetry.com" },
    });
    expect(sendRes.statusCode).toBe(200);

    // Step 2: Agent login (verify + provision in one call)
    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: "cliuser@owlmetry.com", code: testEmailService.lastCode },
    });
    expect(loginRes.statusCode).toBe(201);
    const body = loginRes.json();
    expect(body.api_key).toMatch(/^owl_agent_/);
    expect(body.is_new_setup).toBe(true);

    // Step 3: Agent key works
    const projRes = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${body.api_key}` },
    });
    expect(projRes.statusCode).toBe(200);
    expect(projRes.json().projects).toHaveLength(1);
  });

  it("send-code → agent-login for existing user", async () => {
    const sendRes = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: TEST_USER.email },
    });
    expect(sendRes.statusCode).toBe(200);

    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code: testEmailService.lastCode },
    });
    expect(loginRes.statusCode).toBe(201);
    const body = loginRes.json();
    expect(body.api_key).toMatch(/^owl_agent_/);
    expect(body.is_new_setup).toBe(false);

    // Agent key works
    const projRes = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${body.api_key}` },
    });
    expect(projRes.statusCode).toBe(200);
    expect(projRes.json().projects.length).toBeGreaterThanOrEqual(1);
  });
});
