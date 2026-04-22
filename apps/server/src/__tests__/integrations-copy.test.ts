import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { generateKeyPairSync } from "node:crypto";
import { clearAppleAdsTokenCache } from "../utils/apple-ads/client.js";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_DB_URL,
  TEST_USER,
  getTokenAndTeamId,
  createUserAndGetToken,
  addTeamMember,
  readIntegration,
} from "./setup.js";

let app: FastifyInstance;
let token: string;
let teamId: string;
let sourceProjectId: string;
let targetProjectId: string;

const RC_API_KEY = "sk_test_copy_rc";
const RC_WEBHOOK_SECRET = "whsec_source_secret";

function makeAsaConfig() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    client_id: "SEARCHADS.test-client",
    team_id: "SEARCHADS.test-team",
    key_id: "test-key-id",
    private_key_pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    public_key_pem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    org_id: "40669820",
  };
}

/**
 * Stand in for Apple's token + /acls endpoints so the copy route's end-to-end
 * connection test can run in-process. Returns a `{ restore }` handle; tests
 * must call it to put the real `fetch` back.
 */
function installAppleAdsMock(opts: { tokenStatus?: number; aclsStatus?: number; aclsBody?: unknown } = {}) {
  const { tokenStatus = 200, aclsStatus = 200, aclsBody } = opts;
  const defaultAcls = [{ orgId: 40669820, orgName: "Test Org", currency: "USD", roleNames: ["API Account Read Only"] }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("appleid.apple.com")) {
      return new Response(JSON.stringify({ access_token: "tok-copy", expires_in: 3600 }), { status: tokenStatus, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("api.searchads.apple.com") && url.endsWith("/acls")) {
      return new Response(JSON.stringify({ data: aclsBody ?? defaultAcls }), { status: aclsStatus, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function insertIntegration(projectId: string, provider: string, config: Record<string, unknown>, opts?: { enabled?: boolean; softDeleted?: boolean }) {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const deletedAt = opts?.softDeleted ? new Date() : null;
  const [row] = await client`
    INSERT INTO project_integrations (project_id, provider, config, enabled, deleted_at)
    VALUES (${projectId}, ${provider}, ${JSON.stringify(config)}::jsonb, ${opts?.enabled ?? true}, ${deletedAt})
    RETURNING id, config
  `;
  await client.end();
  return row;
}

async function getUserIdByEmail(email: string): Promise<string> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const [row] = await client`SELECT id FROM users WHERE email = ${email}`;
  await client.end();
  return row.id;
}

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  sourceProjectId = seed.projectId;
  targetProjectId = seed.backendProjectId;
  const auth = await getTokenAndTeamId(app);
  token = auth.token;
  teamId = auth.teamId;
});

afterAll(async () => {
  await app.close();
});

describe("POST /v1/projects/:projectId/integrations/copy-from/:sourceProjectId", () => {
  it("copies RevenueCat credentials, regenerates webhook_secret, enables the target", async () => {
    await insertIntegration(sourceProjectId, "revenuecat", {
      api_key: RC_API_KEY,
      webhook_secret: RC_WEBHOOK_SECRET,
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.provider).toBe("revenuecat");
    expect(body.project_id).toBe(targetProjectId);
    expect(body.enabled).toBe(true);
    expect(body.webhook_setup).toBeDefined();
    expect(body.webhook_setup.webhook_url).toContain(`/v1/webhooks/revenuecat/${targetProjectId}`);

    const targetRow = await readIntegration(targetProjectId, "revenuecat");
    expect(targetRow).not.toBeNull();
    const targetConfig = targetRow!.config as Record<string, string>;
    expect(targetConfig.api_key).toBe(RC_API_KEY);
    expect(targetConfig.webhook_secret).toBeDefined();
    expect(targetConfig.webhook_secret).not.toBe(RC_WEBHOOK_SECRET);
    expect(targetRow!.enabled).toBe(true);
    expect(targetRow!.deleted_at).toBeNull();
  });

  it("copies Apple Search Ads config verbatim, enables the target, and confirms connection to Apple in one step", async () => {
    const sourceConfig = makeAsaConfig();
    await insertIntegration(sourceProjectId, "apple-search-ads", sourceConfig);
    const mock = installAppleAdsMock();
    clearAppleAdsTokenCache();

    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { provider: "apple-search-ads" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.provider).toBe("apple-search-ads");
      expect(body.webhook_setup).toBeUndefined();
      expect(body.enabled).toBe(true);

      // Live /acls round-trip confirms the copied creds still work against
      // Apple — no second "Test Connection" click required.
      expect(body.connection_test).toEqual({
        ok: true,
        orgs: [{ org_id: 40669820, org_name: "Test Org" }],
      });

      const targetRow = await readIntegration(targetProjectId, "apple-search-ads");
      const targetConfig = targetRow!.config as Record<string, string>;
      // Verbatim — keypair, IDs, org all identical to source.
      expect(targetConfig.private_key_pem).toBe(sourceConfig.private_key_pem);
      expect(targetConfig.public_key_pem).toBe(sourceConfig.public_key_pem);
      expect(targetConfig.client_id).toBe(sourceConfig.client_id);
      expect(targetConfig.team_id).toBe(sourceConfig.team_id);
      expect(targetConfig.key_id).toBe(sourceConfig.key_id);
      expect(targetConfig.org_id).toBe(sourceConfig.org_id);
      expect(targetRow!.enabled).toBe(true);
    } finally {
      mock.restore();
      clearAppleAdsTokenCache();
    }
  });

  it("still saves the Apple Search Ads copy but reports the failure when Apple rejects the credentials", async () => {
    const sourceConfig = makeAsaConfig();
    await insertIntegration(sourceProjectId, "apple-search-ads", sourceConfig);
    const mock = installAppleAdsMock({ tokenStatus: 401 });
    clearAppleAdsTokenCache();

    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { provider: "apple-search-ads" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      // Copy is persisted regardless — the user can debug via Test Connection.
      expect(body.enabled).toBe(true);
      expect(body.connection_test.ok).toBe(false);
      expect(body.connection_test.error).toBe("auth_error");
    } finally {
      mock.restore();
      clearAppleAdsTokenCache();
    }
  });

  it("returns 404 when source project has no active integration", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("Source project has no active");
  });

  it("ignores soft-deleted source integration (returns 404)", async () => {
    await insertIntegration(sourceProjectId, "revenuecat", { api_key: RC_API_KEY, webhook_secret: RC_WEBHOOK_SECRET }, { softDeleted: true });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when target project already has a non-deleted integration", async () => {
    await insertIntegration(sourceProjectId, "revenuecat", { api_key: RC_API_KEY, webhook_secret: RC_WEBHOOK_SECRET });
    await insertIntegration(targetProjectId, "revenuecat", { api_key: "sk_existing_target", webhook_secret: "whsec_existing" });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("already exists");
  });

  it("restores a soft-deleted integration on the target project", async () => {
    await insertIntegration(sourceProjectId, "revenuecat", { api_key: RC_API_KEY, webhook_secret: RC_WEBHOOK_SECRET });
    const stale = await insertIntegration(
      targetProjectId,
      "revenuecat",
      { api_key: "sk_stale", webhook_secret: "whsec_stale" },
      { softDeleted: true, enabled: false },
    );

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(stale.id);

    const restored = await readIntegration(targetProjectId, "revenuecat");
    expect(restored!.deleted_at).toBeNull();
    expect(restored!.enabled).toBe(true);
    const restoredConfig = restored!.config as Record<string, string>;
    expect(restoredConfig.api_key).toBe(RC_API_KEY);
    expect(restoredConfig.webhook_secret).not.toBe(RC_WEBHOOK_SECRET);
    expect(restoredConfig.webhook_secret).not.toBe("whsec_stale");
  });

  it("returns 400 when source and target are the same project", async () => {
    await insertIntegration(sourceProjectId, "revenuecat", { api_key: RC_API_KEY, webhook_secret: RC_WEBHOOK_SECRET });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${sourceProjectId}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for unsupported provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "made-up-provider" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Unsupported provider");
  });

  it("returns 403 when source project belongs to a different team", async () => {
    await insertIntegration(sourceProjectId, "revenuecat", { api_key: RC_API_KEY, webhook_secret: RC_WEBHOOK_SECRET });

    // Create a second team with its own project
    const other = await createUserAndGetToken(app, "other@owlmetry.com", "Other User");
    const client = postgres(TEST_DB_URL, { max: 1 });
    const [otherProject] = await client`
      INSERT INTO projects (team_id, name, slug, color)
      VALUES (${other.teamId}, 'Other Team Project', 'other-team-project', '#ef4444')
      RETURNING id
    `;
    await client.end();

    // Other user tries to copy FROM our source project into their project.
    // Their JWT has no access to our source → resolveProject returns 404.
    const resOther = await app.inject({
      method: "POST",
      url: `/v1/projects/${otherProject.id}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: { provider: "revenuecat" },
    });
    expect(resOther.statusCode).toBe(404);

    // If a user somehow has access to both projects but they're in different teams,
    // the same-team check must kick in. Add our seeded user to the other team and retry.
    const seededUserId = await getUserIdByEmail(TEST_USER.email);
    await addTeamMember(other.teamId, seededUserId, "admin");

    const resCrossTeam = await app.inject({
      method: "POST",
      url: `/v1/projects/${otherProject.id}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat" },
    });
    expect(resCrossTeam.statusCode).toBe(403);
    expect(resCrossTeam.json().error).toContain("same team");
  });

  it("returns 403 when the caller is not a team admin", async () => {
    await insertIntegration(sourceProjectId, "revenuecat", { api_key: RC_API_KEY, webhook_secret: RC_WEBHOOK_SECRET });

    // Create a member-role user on the same team
    const member = await createUserAndGetToken(app, "member@owlmetry.com", "Member");
    // createUserAndGetToken always makes a brand-new team; add them to OUR team as 'member'
    await addTeamMember(teamId, member.userId, "member");

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceProjectId}`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { provider: "revenuecat" },
    });

    expect(res.statusCode).toBe(403);
  });
});
