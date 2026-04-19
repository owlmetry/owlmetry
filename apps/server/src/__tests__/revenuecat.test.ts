import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_DB_URL,
  getTokenAndTeamId,
} from "./setup.js";

let app: FastifyInstance;
let projectId: string;
let appId: string;
let token: string;
let teamId: string;

const WEBHOOK_SECRET = "whsec_test_secret_12345";
const RC_API_KEY = "sk_test_revenuecat_key";

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  appId = seed.appId;
  const auth = await getTokenAndTeamId(app);
  token = auth.token;
  teamId = auth.teamId;
});

afterAll(async () => {
  await app.close();
});

// --- Helper: insert RC integration directly into DB ---
async function createRevenueCatIntegration(opts?: { enabled?: boolean; webhookSecret?: string; apiKey?: string }) {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const config = {
    api_key: opts?.apiKey ?? RC_API_KEY,
    webhook_secret: opts?.webhookSecret ?? WEBHOOK_SECRET,
  };
  const [row] = await client`
    INSERT INTO project_integrations (project_id, provider, config, enabled)
    VALUES (${projectId}, 'revenuecat', ${JSON.stringify(config)}::jsonb, ${opts?.enabled ?? true})
    RETURNING id
  `;
  await client.end();
  return row.id;
}

// --- Helper: ingest events to create app_users rows ---
async function ingestEvent(userId: string) {
  await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: {
      bundle_id: TEST_BUNDLE_ID,
      events: [{
        message: "test event",
        level: "info",
        session_id: TEST_SESSION_ID,
        user_id: userId,
        timestamp: new Date().toISOString(),
      }],
    },
  });
  // Wait for fire-and-forget app_users upsert
  await new Promise((r) => setTimeout(r, 100));
}

// --- Helper: read user properties from DB ---
async function getUserProperties(userId: string): Promise<Record<string, string> | null> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const [row] = await client`
    SELECT properties FROM app_users WHERE project_id = ${projectId} AND user_id = ${userId}
  `;
  await client.end();
  return (row?.properties as Record<string, string>) ?? null;
}

// --- Exact RevenueCat webhook payload builders ---

function buildWebhookPayload(eventType: string, overrides: Record<string, unknown> = {}) {
  return {
    api_version: "1.0",
    event: {
      type: eventType,
      id: randomUUID(),
      event_timestamp_ms: Date.now(),
      app_user_id: "rc_user_123",
      original_app_user_id: "rc_user_123",
      aliases: ["rc_user_123"],
      product_id: "premium_monthly",
      entitlement_ids: ["pro"],
      period_type: "NORMAL",
      purchased_at_ms: Date.now() - 86400000,
      expiration_at_ms: Date.now() + 86400000 * 30,
      store: "APP_STORE",
      environment: "PRODUCTION",
      currency: "USD",
      price: 9.99,
      price_in_purchased_currency: 9.99,
      country_code: "US",
      subscriber_attributes: {},
      transaction_id: "txn_" + randomUUID().slice(0, 8),
      original_transaction_id: "orig_txn_" + randomUUID().slice(0, 8),
      ...overrides,
    },
  };
}

// --- V2 API mocks ---

const TEST_RC_PROJECT_ID = "proj_test_abc123";

function buildProjectsResponse(projectId: string = TEST_RC_PROJECT_ID) {
  return {
    object: "list" as const,
    items: [
      { object: "project" as const, id: projectId, name: "Test", created_at: Date.now() },
    ],
    next_page: null,
    url: "/v2/projects",
  };
}

function buildActiveEntitlementsResponse(
  items: Array<{ lookup_key: string; product_identifier: string; expires_at?: number | null }> = [
    { lookup_key: "pro", product_identifier: "premium_monthly", expires_at: Date.now() + 86400000 * 30 },
  ],
) {
  return {
    object: "list" as const,
    items: items.map((i) => ({
      object: "customer.active_entitlement" as const,
      entitlement_id: `ent_${i.lookup_key}`,
      lookup_key: i.lookup_key,
      display_name: i.lookup_key,
      product_identifier: i.product_identifier,
      expires_at: i.expires_at ?? null,
    })),
    next_page: null,
    url: "/v2/projects/.../active_entitlements",
  };
}

function buildSubscriptionsResponse(
  items: Array<{
    id?: string;
    status?: string;
    current_period_starts_at?: number;
    current_period_ends_at?: number | null;
    gives_access?: boolean;
  }> = [],
) {
  const now = Date.now();
  return {
    object: "list" as const,
    items: items.map((i, idx) => ({
      object: "subscription" as const,
      id: i.id ?? `sub_test_${idx}`,
      customer_id: "test",
      product_id: "prod_test",
      starts_at: i.current_period_starts_at ?? now,
      current_period_starts_at: i.current_period_starts_at ?? now,
      current_period_ends_at: i.current_period_ends_at ?? now + 86400000 * 30,
      ends_at: i.current_period_ends_at ?? now + 86400000 * 30,
      status: i.status ?? "active",
      gives_access: i.gives_access ?? true,
      store: "app_store",
      ownership: "purchased",
    })),
    next_page: null,
    url: "/v2/projects/.../subscriptions",
  };
}

/**
 * Install a fetch mock that handles the V2 /projects lookup, the
 * /customers/{id}/active_entitlements call, and the /customers/{id}/subscriptions
 * call. Returns a cleanup function.
 */
function mockRevenueCatV2(options: {
  entitlementsResponse?: unknown;
  entitlementsStatus?: number;
  subscriptionsResponse?: unknown;
  subscriptionsStatus?: number;
  captureAuthHeader?: (header: string | null) => void;
  capturedUrl?: (url: string) => void;
}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    options.capturedUrl?.(url);
    if (url.includes("api.revenuecat.com/v2/projects") && !url.includes("/customers/")) {
      // /v2/projects lookup
      return new Response(JSON.stringify(buildProjectsResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.revenuecat.com/v2/projects") && url.includes("/active_entitlements")) {
      if (options.captureAuthHeader) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        options.captureAuthHeader(headers["Authorization"] ?? null);
      }
      const status = options.entitlementsStatus ?? 200;
      const body = status === 404
        ? { code: 7259, message: "Customer not found." }
        : options.entitlementsResponse ?? buildActiveEntitlementsResponse();
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.revenuecat.com/v2/projects") && url.includes("/subscriptions")) {
      const status = options.subscriptionsStatus ?? 200;
      const body = options.subscriptionsResponse ?? buildSubscriptionsResponse();
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

// ==========================================================================
// WEBHOOK TESTS
// ==========================================================================

describe("POST /v1/webhooks/revenuecat/:projectId", () => {
  it("processes INITIAL_PURCHASE and sets user properties", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("INITIAL_PURCHASE"),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    const props = await getUserProperties("rc_user_123");
    expect(props).toMatchObject({
      rc_subscriber: "true",
      rc_status: "active",
      rc_product: "premium_monthly",
      rc_entitlements: "pro",
      rc_last_purchase: "9.99 USD",
      rc_period_type: "normal",
      rc_billing_period: "monthly",
    });
  });

  it("records rc_period_type=trial for a TRIAL INITIAL_PURCHASE event", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_trial_user");

    const now = Date.now();
    const threeDaysLater = now + 86400000 * 3;
    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("INITIAL_PURCHASE", {
        app_user_id: "rc_trial_user",
        original_app_user_id: "rc_trial_user",
        aliases: ["rc_trial_user"],
        period_type: "TRIAL",
        price: 0,
        price_in_purchased_currency: 0,
        purchased_at_ms: now,
        expiration_at_ms: threeDaysLater,
      }),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("rc_trial_user");
    expect(props?.rc_period_type).toBe("trial");
    expect(props?.rc_billing_period).toBe("weekly");
    expect(props?.rc_subscriber).toBe("true");
  });

  it("processes RENEWAL event", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("RENEWAL", { is_trial_conversion: false }),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("rc_user_123");
    expect(props?.rc_subscriber).toBe("true");
    expect(props?.rc_status).toBe("active");
  });

  it("processes CANCELLATION event", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("CANCELLATION", {
        cancel_reason: "UNSUBSCRIBE",
      }),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("rc_user_123");
    expect(props?.rc_subscriber).toBe("false");
    expect(props?.rc_status).toBe("cancelled");
  });

  it("processes BILLING_ISSUE event", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("BILLING_ISSUE"),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("rc_user_123");
    expect(props?.rc_status).toBe("billing_issue");
  });

  it("processes EXPIRATION event", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("EXPIRATION", {
        expiration_reason: "UNSUBSCRIBE",
      }),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("rc_user_123");
    expect(props?.rc_subscriber).toBe("false");
    expect(props?.rc_status).toBe("expired");
  });

  it("processes UNCANCELLATION event", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("UNCANCELLATION"),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("rc_user_123");
    expect(props?.rc_subscriber).toBe("true");
    expect(props?.rc_status).toBe("active");
  });

  it("processes PRODUCT_CHANGE event", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("PRODUCT_CHANGE", {
        new_product_id: "premium_annual",
      }),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("rc_user_123");
    expect(props?.rc_subscriber).toBe("true");
    expect(props?.rc_status).toBe("active");
    expect(props?.rc_product).toBe("premium_monthly"); // product_id stays the original
  });

  it("falls back to original_app_user_id when app_user_id is null", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("original_user");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("INITIAL_PURCHASE", {
        app_user_id: null,
        original_app_user_id: "original_user",
      }),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("original_user");
    expect(props?.rc_subscriber).toBe("true");
  });

  it("creates app_users row if user does not exist yet", async () => {
    await createRevenueCatIntegration();
    // No ingestEvent — user doesn't exist in app_users

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("INITIAL_PURCHASE", {
        app_user_id: "new_user_from_rc",
      }),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("new_user_from_rc");
    expect(props?.rc_subscriber).toBe("true");
  });

  it("merges properties with existing ones (does not overwrite)", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    // Set an existing property via user properties endpoint
    await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "rc_user_123", properties: { custom_tier: "gold" } },
    });

    // Now webhook comes in
    await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("INITIAL_PURCHASE"),
    });

    const props = await getUserProperties("rc_user_123");
    expect(props?.custom_tier).toBe("gold"); // preserved
    expect(props?.rc_subscriber).toBe("true"); // added
  });

  it("returns 401 for wrong webhook secret", async () => {
    await createRevenueCatIntegration();

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: "Bearer wrong_secret" },
      payload: buildWebhookPayload("INITIAL_PURCHASE"),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/Invalid webhook secret/);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${randomUUID()}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("INITIAL_PURCHASE"),
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for disabled integration", async () => {
    await createRevenueCatIntegration({ enabled: false });

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("INITIAL_PURCHASE"),
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for missing event in payload", async () => {
    await createRevenueCatIntegration();

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: { api_version: "1.0" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("handles TEST event type gracefully (no properties set)", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
      payload: buildWebhookPayload("TEST", {
        product_id: undefined,
        entitlement_ids: undefined,
        price_in_purchased_currency: undefined,
        currency: undefined,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    // No properties should be set for TEST events
    const props = await getUserProperties("rc_user_123");
    expect(props).toBeNull();
  });

  it("skips webhook auth when webhook_secret is not configured", async () => {
    await createRevenueCatIntegration({ webhookSecret: "" });
    await ingestEvent("rc_user_123");

    // Empty webhook_secret means no auth check — webhook should work without auth header
    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/revenuecat/${projectId}`,
      payload: buildWebhookPayload("INITIAL_PURCHASE"),
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("rc_user_123");
    expect(props?.rc_subscriber).toBe("true");
  });
});

// ==========================================================================
// SINGLE-USER SYNC TESTS (with mocked RC API)
// ==========================================================================

describe("POST /v1/projects/:projectId/integrations/revenuecat/sync/:userId", () => {
  it("fetches subscriber from RC API and updates user properties", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("rc_user_123");

    const cleanup = mockRevenueCatV2({});
    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/integrations/revenuecat/sync/rc_user_123`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.updated).toBeGreaterThanOrEqual(1);
      expect(body.properties.rc_subscriber).toBe("true");
      expect(body.properties.rc_status).toBe("active");
      expect(body.properties.rc_product).toBe("premium_monthly");
      expect(body.properties.rc_entitlements).toBe("pro");

      // Verify DB was updated
      const props = await getUserProperties("rc_user_123");
      expect(props?.rc_subscriber).toBe("true");
    } finally {
      cleanup();
    }
  });

  it("sets rc_period_type=trial and rc_billing_period=weekly for a trialing subscription", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("trial_user");

    const now = Date.now();
    const cleanup = mockRevenueCatV2({
      subscriptionsResponse: buildSubscriptionsResponse([
        {
          status: "trialing",
          current_period_starts_at: now,
          current_period_ends_at: now + 86400000 * 3, // 3-day trial
        },
      ]),
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/integrations/revenuecat/sync/trial_user`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const props = res.json().properties;
      expect(props.rc_subscriber).toBe("true");
      expect(props.rc_period_type).toBe("trial");
      expect(props.rc_billing_period).toBe("weekly"); // 3 days falls in weekly bucket
    } finally {
      cleanup();
    }
  });

  it("sets rc_period_type=normal and rc_billing_period=yearly for an active yearly subscription", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("yearly_user");

    const now = Date.now();
    const cleanup = mockRevenueCatV2({
      subscriptionsResponse: buildSubscriptionsResponse([
        {
          status: "active",
          current_period_starts_at: now,
          current_period_ends_at: now + 86400000 * 365,
        },
      ]),
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/integrations/revenuecat/sync/yearly_user`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const props = res.json().properties;
      expect(props.rc_subscriber).toBe("true");
      expect(props.rc_period_type).toBe("normal");
      expect(props.rc_billing_period).toBe("yearly");
    } finally {
      cleanup();
    }
  });

  it("marks lifetime entitlement (no subscription) as rc_billing_period=lifetime", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("lifetime_user");

    // Active entitlement with null expires_at (lifetime) + empty subscriptions list
    // → promotional/lifetime grant.
    const cleanup = mockRevenueCatV2({
      entitlementsResponse: buildActiveEntitlementsResponse([
        { lookup_key: "pro", product_identifier: "lifetime_pro", expires_at: null },
      ]),
      subscriptionsResponse: buildSubscriptionsResponse([]),
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/integrations/revenuecat/sync/lifetime_user`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const props = res.json().properties;
      expect(props.rc_subscriber).toBe("true");
      expect(props.rc_billing_period).toBe("lifetime");
      expect(props.rc_period_type).toBe("promotional");
    } finally {
      cleanup();
    }
  });

  it("returns 404 when RC API returns customer not found", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("nonexistent_user");

    const cleanup = mockRevenueCatV2({ entitlementsStatus: 404 });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/integrations/revenuecat/sync/nonexistent_user`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/Subscriber not found/);
    } finally {
      cleanup();
    }
  });

  it("maps a customer with no active entitlements to inactive properties", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("expired_user");

    // V2 /active_entitlements returns 200 with empty items for a customer
    // that exists but has no active subscription.
    const cleanup = mockRevenueCatV2({
      entitlementsResponse: buildActiveEntitlementsResponse([]),
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/integrations/revenuecat/sync/expired_user`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().properties.rc_subscriber).toBe("false");
      expect(res.json().properties.rc_status).toBe("expired");
    } finally {
      cleanup();
    }
  });

  it("maps a lifetime (null expires_at) entitlement as active", async () => {
    await createRevenueCatIntegration();
    await ingestEvent("lifetime_user");

    const cleanup = mockRevenueCatV2({
      entitlementsResponse: buildActiveEntitlementsResponse([
        { lookup_key: "pro", product_identifier: "lifetime_pro", expires_at: null },
      ]),
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/integrations/revenuecat/sync/lifetime_user`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().properties.rc_subscriber).toBe("true");
      expect(res.json().properties.rc_status).toBe("active");
      expect(res.json().properties.rc_product).toBe("lifetime_pro");
    } finally {
      cleanup();
    }
  });

  it("sends correct Authorization header to RC API", async () => {
    await createRevenueCatIntegration({ apiKey: "sk_my_special_key" });
    await ingestEvent("rc_user_123");

    let capturedAuthHeader: string | null = null;
    const cleanup = mockRevenueCatV2({
      captureAuthHeader: (h) => { capturedAuthHeader = h; },
    });
    try {
      await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/integrations/revenuecat/sync/rc_user_123`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(capturedAuthHeader).toBe("Bearer sk_my_special_key");
    } finally {
      cleanup();
    }
  });

  it("returns 404 when integration is not configured", async () => {
    // No integration created

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations/revenuecat/sync/rc_user_123`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/not found/);
  });
});

// ==========================================================================
// USER PROPERTIES ENDPOINT TESTS
// ==========================================================================

describe("POST /v1/identity/properties", () => {
  it("sets properties on existing user", async () => {
    await ingestEvent("user_1");

    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: { plan: "premium", org: "acme" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(true);
    expect(res.json().properties).toEqual({ plan: "premium", org: "acme" });
  });

  it("merges properties without overwriting existing keys", async () => {
    await ingestEvent("user_1");

    await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: { plan: "free", org: "acme" } },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: { plan: "premium", role: "admin" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().properties).toEqual({ plan: "premium", org: "acme", role: "admin" });
  });

  it("removes properties when value is empty string", async () => {
    await ingestEvent("user_1");

    await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: { plan: "free", org: "acme" } },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: { org: "" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().properties).toEqual({ plan: "free" }); // org removed
  });

  it("creates app_users row if user does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "brand_new_user", properties: { plan: "trial" } },
    });

    expect(res.statusCode).toBe(200);
    const props = await getUserProperties("brand_new_user");
    expect(props?.plan).toBe("trial");
  });

  it("validates key length", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: { ["a".repeat(51)]: "val" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/exceeds max length/);
  });

  it("validates value length", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: { key: "a".repeat(201) } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/exceeds max length/);
  });

  it("validates total property count", async () => {
    await ingestEvent("user_1");

    const bigProps: Record<string, string> = {};
    for (let i = 0; i < 51; i++) bigProps[`key_${i}`] = "val";

    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: bigProps },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/exceeds max/);
  });

  it("requires user_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { properties: { plan: "free" } },
    });

    expect(res.statusCode).toBe(400);
  });

  it("requires properties to be an object", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "user_1", properties: "not_an_object" },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ==========================================================================
// INTEGRATIONS CRUD TESTS
// ==========================================================================

describe("Integrations CRUD", () => {
  it("creates a RevenueCat integration with valid config", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_test_key" } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.provider).toBe("revenuecat");
    expect(body.enabled).toBe(true);
    expect(body.config.api_key).toBe("sk_t****"); // redacted
    expect(body.config.webhook_secret).toMatch(/^whse/); // auto-generated, redacted
    expect(body.webhook_setup).toBeDefined();
    expect(body.webhook_setup.webhook_url).toContain(`/v1/webhooks/revenuecat/${projectId}`);
    expect(body.webhook_setup.authorization_header).toMatch(/^Bearer whsec_/);
  });

  it("rejects unsupported provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "stripe", config: { api_key: "sk_test" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Unsupported/);
  });

  it("rejects missing required config field", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: {} },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/api_key/);
  });

  it("rejects unknown config fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_test", bogus_field: "val" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Unknown config field/);
  });

  it("lists integrations", async () => {
    await createRevenueCatIntegration();

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().integrations).toHaveLength(1);
    expect(res.json().integrations[0].provider).toBe("revenuecat");
  });

  it("lists supported providers", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/integrations/providers`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers).toHaveLength(1);
    expect(res.json().providers[0].id).toBe("revenuecat");
    expect(res.json().providers[0].configFields.length).toBeGreaterThan(0);
  });

  it("updates integration config (partial update merges)", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_original" } },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/integrations/revenuecat`,
      headers: { authorization: `Bearer ${token}` },
      payload: { config: { api_key: "sk_updated" } },
    });

    expect(res.statusCode).toBe(200);
    // api_key should be updated, webhook_secret still present (auto-generated at creation)
    expect(res.json().config.api_key).toMatch(/sk_u/); // redacted but present
    expect(res.json().config.webhook_secret).toMatch(/whse/); // redacted but present
  });

  it("toggles integration enabled/disabled", async () => {
    await createRevenueCatIntegration();

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/integrations/revenuecat`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
  });

  it("soft-deletes integration", async () => {
    await createRevenueCatIntegration();

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/integrations/revenuecat`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    // Should no longer appear in list
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().integrations).toHaveLength(0);
  });

  it("prevents duplicate integration for same provider", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_test" } },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_test_2" } },
    });

    expect(res.statusCode).toBe(409);
  });

  it("restores soft-deleted integration on re-create", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_old" } },
    });

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/integrations/revenuecat`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_new" } },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().enabled).toBe(true);
  });

  it("auto-generates webhook_secret and returns webhook_setup on creation", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_test_key" } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.webhook_setup).toBeDefined();
    expect(body.webhook_setup.authorization_header).toMatch(/^Bearer whsec_[a-f0-9]{48}$/);
    expect(body.webhook_setup.webhook_url).toContain(`/v1/webhooks/revenuecat/${projectId}`);
    // Config should have redacted auto-generated secret
    expect(body.config.webhook_secret).toMatch(/^whse/);
  });

  it("does not include webhook_setup in list response", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { provider: "revenuecat", config: { api_key: "sk_test_key" } },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/integrations`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().integrations[0].webhook_setup).toBeUndefined();
  });
});
