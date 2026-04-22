import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_DB_URL,
  getTokenAndTeamId,
} from "./setup.js";

let app: FastifyInstance;
let token: string;
let projectId: string;

async function readIntegrationConfig(): Promise<Record<string, unknown>> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const [row] = await client`
    SELECT config, enabled FROM project_integrations
    WHERE project_id = ${projectId} AND provider = 'apple-search-ads' AND deleted_at IS NULL
  `;
  await client.end();
  return { ...(row.config as Record<string, unknown>), enabled: row.enabled };
}

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  const auth = await getTokenAndTeamId(app);
  token = auth.token;
});

afterAll(async () => {
  await app.close();
});

describe("Apple Search Ads integration lifecycle", () => {
  it("creates a pending integration with a server-generated keypair when config is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "apple-search-ads", config: {} },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.provider).toBe("apple-search-ads");
    expect(body.enabled).toBe(false);
    // Public key visible for the user to copy into Apple's UI.
    expect(body.config.public_key_pem).toContain("-----BEGIN PUBLIC KEY-----");
    // Private key redacted in the API response.
    expect(body.config.private_key_pem).toMatch(/\*{4}$/);

    const stored = await readIntegrationConfig();
    expect(stored.private_key_pem).toEqual(expect.stringContaining("-----BEGIN PRIVATE KEY-----"));
    expect(stored.public_key_pem).toEqual(expect.stringContaining("-----BEGIN PUBLIC KEY-----"));
    expect(stored.client_id).toBeUndefined();
    expect(stored.enabled).toBe(false);
  });

  it("ignores user-supplied private_key_pem and public_key_pem on create", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        provider: "apple-search-ads",
        config: {
          private_key_pem: "injected-private",
          public_key_pem: "injected-public",
        },
      },
    });

    expect(res.statusCode).toBe(201);
    const stored = await readIntegrationConfig();
    expect(stored.private_key_pem).not.toBe("injected-private");
    expect(stored.public_key_pem).not.toBe("injected-public");
    expect(stored.private_key_pem).toEqual(expect.stringContaining("-----BEGIN PRIVATE KEY-----"));
  });

  it("stays pending after partial PATCH with only client/team/key", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "apple-search-ads", config: {} },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/integrations/apple-search-ads`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        config: {
          client_id: "SEARCHADS.c",
          team_id: "SEARCHADS.t",
          key_id: "k",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);

    const stored = await readIntegrationConfig();
    expect(stored.client_id).toBe("SEARCHADS.c");
    expect(stored.team_id).toBe("SEARCHADS.t");
    expect(stored.key_id).toBe("k");
    expect(stored.org_id).toBeUndefined();
    expect(stored.enabled).toBe(false);
  });

  it("auto-enables when the fourth ID (org_id) lands via PATCH", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "apple-search-ads", config: {} },
    });
    await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/integrations/apple-search-ads`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        config: { client_id: "SEARCHADS.c", team_id: "SEARCHADS.t", key_id: "k" },
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/integrations/apple-search-ads`,
      headers: { authorization: `Bearer ${token}` },
      payload: { config: { org_id: "40669820" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);

    const stored = await readIntegrationConfig();
    expect(stored.enabled).toBe(true);
    expect(stored.org_id).toBe("40669820");
  });

  it("strips user-supplied private_key_pem on PATCH and preserves the server-generated one", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "apple-search-ads", config: {} },
    });
    expect(createRes.statusCode).toBe(201);
    const originalPrivate = (await readIntegrationConfig()).private_key_pem as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/integrations/apple-search-ads`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        config: {
          client_id: "SEARCHADS.c",
          private_key_pem: "attacker-supplied",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const stored = await readIntegrationConfig();
    expect(stored.private_key_pem).toBe(originalPrivate);
    expect(stored.client_id).toBe("SEARCHADS.c");
  });

  it("ignores enabled: true from the client for apple-search-ads (derived only)", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "apple-search-ads", config: {} },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/integrations/apple-search-ads`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
    expect((await readIntegrationConfig()).enabled).toBe(false);
  });
});
