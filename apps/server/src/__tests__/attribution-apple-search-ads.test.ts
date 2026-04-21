import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  ATTRIBUTION_SOURCE_PROPERTY,
  ATTRIBUTION_SOURCE_VALUES,
} from "@owlmetry/shared";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let projectId: string;

const APPLE_ENDPOINT = "api-adservices.apple.com/api/v1/";
const FAKE_TOKEN = "AAAAAAAA.BBBBBBBB.CCCCCCCC";
const ASA_ROUTE = "/v1/identity/attribution/apple-search-ads";

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
});

afterAll(async () => {
  await app.close();
});

async function ingestEvent(userId: string) {
  await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: {
      bundle_id: TEST_BUNDLE_ID,
      events: [
        {
          message: "test event",
          level: "info",
          session_id: TEST_SESSION_ID,
          user_id: userId,
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
  // Wait for fire-and-forget app_users upsert
  await new Promise((r) => setTimeout(r, 100));
}

async function getUserProperties(userId: string): Promise<Record<string, string> | null> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const [row] = await client`
    SELECT properties FROM app_users WHERE project_id = ${projectId} AND user_id = ${userId}
  `;
  await client.end();
  return (row?.properties as Record<string, string>) ?? null;
}

/**
 * Install a fetch mock for Apple's attribution endpoint. Returns a cleanup.
 * Tests call `fetchCalled()` at the end to confirm whether Apple was (or
 * wasn't) hit — important for verifying dev_mock short-circuits.
 */
function mockAppleAttribution(options: {
  status?: number;
  body?: unknown;
  bodyText?: string;
}) {
  const originalFetch = globalThis.fetch;
  let appleHits = 0;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes(APPLE_ENDPOINT)) {
      appleHits++;
      const status = options.status ?? 200;
      if (options.bodyText !== undefined) {
        return new Response(options.bodyText, {
          status,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response(JSON.stringify(options.body ?? {}), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return {
    cleanup: () => {
      globalThis.fetch = originalFetch;
    },
    fetchCalled: () => appleHits,
  };
}

const ATTRIBUTED_RESPONSE = {
  attribution: true,
  orgId: 40669820,
  campaignId: 542370539,
  adGroupId: 542317095,
  keywordId: 87675432,
  creativeSetId: 542317096,
  adId: 542317097,
  conversionType: "Download",
  claimType: "click",
  countryOrRegion: "US",
  clickDate: "2026-01-01T00:00:00Z",
};

describe("POST /v1/identity/attribution/apple-search-ads", () => {
  it("writes asa_* props and attribution_source=apple_search_ads when Apple attributes the install", async () => {
    const mock = mockAppleAttribution({ body: ATTRIBUTED_RESPONSE });
    try {
      const res = await app.inject({
        method: "POST",
        url: ASA_ROUTE,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: { user_id: "user-attrib-1", attribution_token: FAKE_TOKEN },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attributed).toBe(true);
      expect(body.pending).toBe(false);
      expect(body.properties[ATTRIBUTION_SOURCE_PROPERTY]).toBe(ATTRIBUTION_SOURCE_VALUES.appleSearchAds);
      expect(body.properties.asa_campaign_id).toBe("542370539");
      expect(body.properties.asa_ad_group_id).toBe("542317095");
      expect(body.properties.asa_keyword_id).toBe("87675432");
      expect(body.properties.asa_claim_type).toBe("click");
      expect(body.properties.asa_ad_id).toBe("542317097");
      expect(body.properties.asa_creative_set_id).toBe("542317096");

      const stored = await getUserProperties("user-attrib-1");
      expect(stored).not.toBeNull();
      expect(stored![ATTRIBUTION_SOURCE_PROPERTY]).toBe(ATTRIBUTION_SOURCE_VALUES.appleSearchAds);
      expect(stored!.asa_campaign_id).toBe("542370539");
      expect(mock.fetchCalled()).toBe(1);
    } finally {
      mock.cleanup();
    }
  });

  it("sets attribution_source=none and no asa_* props when Apple responds but attribution=false", async () => {
    const mock = mockAppleAttribution({ body: { attribution: false } });
    try {
      const res = await app.inject({
        method: "POST",
        url: ASA_ROUTE,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: { user_id: "user-attrib-unattributed", attribution_token: FAKE_TOKEN },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attributed).toBe(false);
      expect(body.pending).toBe(false);
      expect(body.properties[ATTRIBUTION_SOURCE_PROPERTY]).toBe(ATTRIBUTION_SOURCE_VALUES.none);
      expect(Object.keys(body.properties).filter((k) => k.startsWith("asa_"))).toEqual([]);

      const stored = await getUserProperties("user-attrib-unattributed");
      expect(stored![ATTRIBUTION_SOURCE_PROPERTY]).toBe(ATTRIBUTION_SOURCE_VALUES.none);
      expect(Object.keys(stored!).filter((k) => k.startsWith("asa_"))).toEqual([]);
    } finally {
      mock.cleanup();
    }
  });

  it("returns pending with retry_after_seconds when Apple returns 404 and writes no properties", async () => {
    const mock = mockAppleAttribution({ status: 404, body: {} });
    try {
      const res = await app.inject({
        method: "POST",
        url: ASA_ROUTE,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: { user_id: "user-attrib-pending", attribution_token: FAKE_TOKEN },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attributed).toBeNull();
      expect(body.pending).toBe(true);
      expect(body.retry_after_seconds).toBeGreaterThan(0);
      expect(body.properties).toEqual({});

      const stored = await getUserProperties("user-attrib-pending");
      expect(stored).toBeNull();
    } finally {
      mock.cleanup();
    }
  });

  it("returns 400 when Apple rejects the token as invalid (400)", async () => {
    const mock = mockAppleAttribution({ status: 400, bodyText: "invalid token" });
    try {
      const res = await app.inject({
        method: "POST",
        url: ASA_ROUTE,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: { user_id: "user-attrib-invalid", attribution_token: "bad" },
      });
      expect(res.statusCode).toBe(400);
      const stored = await getUserProperties("user-attrib-invalid");
      expect(stored).toBeNull();
    } finally {
      mock.cleanup();
    }
  });

  it("returns 502 on Apple 5xx (non-retriable at the route level; SDK handles retry)", async () => {
    const mock = mockAppleAttribution({ status: 503, bodyText: "service unavailable" });
    try {
      const res = await app.inject({
        method: "POST",
        url: ASA_ROUTE,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: { user_id: "user-attrib-5xx", attribution_token: FAKE_TOKEN },
      });
      expect(res.statusCode).toBe(502);
    } finally {
      mock.cleanup();
    }
  });

  it("dev_mock=attributed does NOT hit Apple and writes canned asa_* properties", async () => {
    const mock = mockAppleAttribution({ body: {} });
    try {
      const res = await app.inject({
        method: "POST",
        url: ASA_ROUTE,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: {
          user_id: "user-attrib-mock",
          attribution_token: "ignored-in-mock",
          dev_mock: "attributed",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attributed).toBe(true);
      expect(body.properties[ATTRIBUTION_SOURCE_PROPERTY]).toBe(ATTRIBUTION_SOURCE_VALUES.appleSearchAds);
      expect(body.properties.asa_campaign_id).toBeTruthy();
      expect(body.properties.asa_claim_type).toBe("click");
      expect(mock.fetchCalled()).toBe(0);
    } finally {
      mock.cleanup();
    }
  });

  it("dev_mock=pending does NOT hit Apple and returns pending", async () => {
    const mock = mockAppleAttribution({ body: {} });
    try {
      const res = await app.inject({
        method: "POST",
        url: ASA_ROUTE,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: {
          user_id: "user-attrib-mock-pending",
          attribution_token: "ignored",
          dev_mock: "pending",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pending).toBe(true);
      expect(body.attributed).toBeNull();
      expect(mock.fetchCalled()).toBe(0);
    } finally {
      mock.cleanup();
    }
  });

  it("returns 400 for an unknown attribution source slug", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/attribution/not-a-real-network",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "whatever", attribution_token: "whatever" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("identity claim carries asa_* + attribution_source from anon to real user", async () => {
    const anonId = "owl_anon_attribflow_1";
    const realId = "real-user-attribflow-1";

    // Create anon app_user via an event so the claim route has source data
    await ingestEvent(anonId);

    // Submit attribution for the anon user via dev_mock (no Apple)
    const mock = mockAppleAttribution({ body: {} });
    try {
      const attribRes = await app.inject({
        method: "POST",
        url: ASA_ROUTE,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: {
          user_id: anonId,
          attribution_token: "ignored",
          dev_mock: "attributed",
        },
      });
      expect(attribRes.statusCode).toBe(200);
    } finally {
      mock.cleanup();
    }

    // Claim anon → real
    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/identity/claim",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { anonymous_id: anonId, user_id: realId },
    });
    expect(claimRes.statusCode).toBe(200);

    const realProps = await getUserProperties(realId);
    expect(realProps).not.toBeNull();
    expect(realProps![ATTRIBUTION_SOURCE_PROPERTY]).toBe(ATTRIBUTION_SOURCE_VALUES.appleSearchAds);
    expect(realProps!.asa_campaign_id).toBeTruthy();
  });

  it("returns 400 when user_id is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: ASA_ROUTE,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { attribution_token: FAKE_TOKEN },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when attribution_token is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: ASA_ROUTE,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { user_id: "someone" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a client key", async () => {
    const res = await app.inject({
      method: "POST",
      url: ASA_ROUTE,
      payload: { user_id: "someone", attribution_token: FAKE_TOKEN },
    });
    expect(res.statusCode).toBe(401);
  });
});
