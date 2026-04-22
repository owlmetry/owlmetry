import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  getAppleAdsCampaign,
  getAppleAdsAdGroup,
  getAppleAdsAcls,
  clearAppleAdsTokenCache,
} from "../utils/apple-ads/client.js";
import type { AppleAdsConfig } from "../utils/apple-ads/config.js";

function makeConfig(overrides: Partial<AppleAdsConfig> = {}): AppleAdsConfig {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    client_id: "SEARCHADS.test-client",
    team_id: "SEARCHADS.test-team",
    key_id: "test-key-id",
    private_key_pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    org_id: "40669820",
    ...overrides,
  };
}

interface MockedCall {
  url: string;
  headers: Record<string, string>;
  body?: string;
  method: string;
}

function installFetchMock(
  handler: (call: MockedCall) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>,
) {
  const calls: MockedCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    const call: MockedCall = {
      url,
      headers,
      body: init?.body as string | undefined,
      method: (init?.method ?? "GET").toUpperCase(),
    };
    calls.push(call);
    const result = await handler(call);
    return new Response(typeof result.body === "string" ? result.body : JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("Apple Ads client", () => {
  beforeEach(() => {
    clearAppleAdsTokenCache();
  });
  afterEach(() => {
    clearAppleAdsTokenCache();
  });

  it("mints an access token and forwards it as Bearer on the next campaign lookup", async () => {
    const config = makeConfig();
    const mock = installFetchMock((call) => {
      if (call.url.includes("appleid.apple.com")) {
        expect(call.method).toBe("POST");
        expect(call.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
        expect(call.body).toContain("grant_type=client_credentials");
        expect(call.body).toContain("scope=searchadsorg");
        return { status: 200, body: { access_token: "tok-abc", expires_in: 3600 } };
      }
      if (call.url.includes("api.searchads.apple.com")) {
        expect(call.headers.Authorization).toBe("Bearer tok-abc");
        expect(call.headers["X-AP-Context"]).toBe("orgId=40669820");
        return { status: 200, body: { data: { id: 542370539, name: "USA Main", status: "ENABLED" } } };
      }
      throw new Error(`Unexpected URL: ${call.url}`);
    });

    try {
      const result = await getAppleAdsCampaign(config, 542370539);
      expect(result).toEqual({ status: "found", data: { id: 542370539, name: "USA Main", status: "ENABLED" } });

      const tokenCalls = mock.calls.filter((c) => c.url.includes("appleid.apple.com"));
      const campaignCalls = mock.calls.filter((c) => c.url.includes("api.searchads.apple.com"));
      expect(tokenCalls).toHaveLength(1);
      expect(campaignCalls).toHaveLength(1);
      expect(campaignCalls[0].url).toContain("/api/v5/campaigns/542370539");
    } finally {
      mock.restore();
    }
  });

  it("reuses the cached access token across calls within its TTL", async () => {
    const config = makeConfig();
    const mock = installFetchMock((call) => {
      if (call.url.includes("appleid.apple.com")) {
        return { status: 200, body: { access_token: "tok-cached", expires_in: 3600 } };
      }
      if (call.url.includes("adgroups/222")) {
        expect(call.headers.Authorization).toBe("Bearer tok-cached");
        return { status: 200, body: { data: { id: 222, name: "AG 222" } } };
      }
      return { status: 200, body: { data: { id: 111, name: "Campaign 111" } } };
    });

    try {
      await getAppleAdsCampaign(config, 111);
      await getAppleAdsAdGroup(config, 111, 222);

      const tokenCalls = mock.calls.filter((c) => c.url.includes("appleid.apple.com"));
      expect(tokenCalls).toHaveLength(1);
    } finally {
      mock.restore();
    }
  });

  it("re-mints once on a 401 and retries the original request", async () => {
    const config = makeConfig();
    let tokenHits = 0;
    let campaignHits = 0;
    const mock = installFetchMock((call) => {
      if (call.url.includes("appleid.apple.com")) {
        tokenHits++;
        return { status: 200, body: { access_token: `tok-${tokenHits}`, expires_in: 3600 } };
      }
      campaignHits++;
      if (campaignHits === 1) {
        return { status: 401, body: { error: "expired token" } };
      }
      return { status: 200, body: { data: { id: 111, name: "Campaign 111" } } };
    });

    try {
      const result = await getAppleAdsCampaign(config, 111);
      expect(result).toEqual({ status: "found", data: { id: 111, name: "Campaign 111" } });
      expect(tokenHits).toBe(2);
      expect(campaignHits).toBe(2);
    } finally {
      mock.restore();
    }
  });

  it("returns auth_error on 403", async () => {
    const config = makeConfig();
    const mock = installFetchMock((call) => {
      if (call.url.includes("appleid.apple.com")) {
        return { status: 200, body: { access_token: "tok", expires_in: 3600 } };
      }
      return { status: 403, body: "wrong org" };
    });

    try {
      const result = await getAppleAdsCampaign(config, 111);
      expect(result.status).toBe("auth_error");
    } finally {
      mock.restore();
    }
  });

  it("returns not_found on 404", async () => {
    const config = makeConfig();
    const mock = installFetchMock((call) => {
      if (call.url.includes("appleid.apple.com")) {
        return { status: 200, body: { access_token: "tok", expires_in: 3600 } };
      }
      return { status: 404, body: "" };
    });

    try {
      const result = await getAppleAdsCampaign(config, 999);
      expect(result).toEqual({ status: "not_found" });
    } finally {
      mock.restore();
    }
  });

  it("surfaces auth_error when the OAuth exchange itself fails", async () => {
    const config = makeConfig();
    const mock = installFetchMock((call) => {
      if (call.url.includes("appleid.apple.com")) {
        return { status: 400, body: { error: "invalid_client" } };
      }
      throw new Error("should not reach Apple Ads API");
    });

    try {
      const result = await getAppleAdsCampaign(config, 111);
      expect(result.status).toBe("auth_error");
    } finally {
      mock.restore();
    }
  });

  it("getAppleAdsAcls does NOT include the X-AP-Context header", async () => {
    const config = makeConfig();
    const mock = installFetchMock((call) => {
      if (call.url.includes("appleid.apple.com")) {
        return { status: 200, body: { access_token: "tok", expires_in: 3600 } };
      }
      expect(call.url).toContain("/api/v5/acls");
      expect(call.headers["X-AP-Context"]).toBeUndefined();
      return { status: 200, body: { data: [{ orgId: 40669820, orgName: "Acme Inc" }] } };
    });

    try {
      const result = await getAppleAdsAcls({
        client_id: config.client_id,
        team_id: config.team_id,
        key_id: config.key_id,
        private_key_pem: config.private_key_pem,
      });
      expect(result).toEqual({ status: "found", data: [{ orgId: 40669820, orgName: "Acme Inc" }] });
    } finally {
      mock.restore();
    }
  });

  it("returns error with the upstream status on a 5xx", async () => {
    const config = makeConfig();
    const mock = installFetchMock((call) => {
      if (call.url.includes("appleid.apple.com")) {
        return { status: 200, body: { access_token: "tok", expires_in: 3600 } };
      }
      return { status: 503, body: "service unavailable" };
    });

    try {
      const result = await getAppleAdsCampaign(config, 111);
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.statusCode).toBe(503);
      }
    } finally {
      mock.restore();
    }
  });
});
