import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { enrichAppleAdsNames } from "../utils/apple-ads/enrich.js";
import { clearAppleAdsTokenCache } from "../utils/apple-ads/client.js";
import type { AppleAdsConfig } from "../utils/apple-ads/config.js";

function makeConfig(): AppleAdsConfig {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    client_id: "SEARCHADS.c",
    team_id: "SEARCHADS.t",
    key_id: "k",
    private_key_pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    public_key_pem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    org_id: "40669820",
  };
}

function installFetchMock(
  handler: (url: string, method: string) => { status: number; body: unknown },
) {
  const calls: Array<{ url: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (url.includes("appleid.apple.com")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const result = handler(url, method);
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

describe("enrichAppleAdsNames", () => {
  beforeEach(() => clearAppleAdsTokenCache());
  afterEach(() => clearAppleAdsTokenCache());

  it("returns empty props when asa_campaign_id is absent", async () => {
    const config = makeConfig();
    // No fetch mock — if this calls Apple the test will surface it via the
    // fetch exception, since no network is allowed.
    const outcome = await enrichAppleAdsNames(config, { asa_ad_group_id: "222" });
    expect(outcome.props).toEqual({});
    expect(outcome.fieldErrors).toEqual([]);
  });

  it("resolves all four fields when all ids are present", async () => {
    const config = makeConfig();
    const mock = installFetchMock((url) => {
      if (url.includes("/targetingkeywords/87675432")) {
        return { status: 200, body: { data: { id: 87675432, text: "mockup creator" } } };
      }
      if (url.includes("/ads/777")) {
        return { status: 200, body: { data: { id: 777, name: "Ad Seven" } } };
      }
      if (url.includes("/adgroups/222")) {
        return { status: 200, body: { data: { id: 222, name: "AG Broad" } } };
      }
      if (url.includes("/campaigns/111")) {
        return { status: 200, body: { data: { id: 111, name: "Holiday US" } } };
      }
      return { status: 404, body: "" };
    });

    try {
      const outcome = await enrichAppleAdsNames(config, {
        asa_campaign_id: "111",
        asa_ad_group_id: "222",
        asa_keyword_id: "87675432",
        asa_ad_id: "777",
      });
      expect(outcome.props).toEqual({
        asa_campaign_name: "Holiday US",
        asa_ad_group_name: "AG Broad",
        asa_keyword: "mockup creator",
        asa_ad_name: "Ad Seven",
      });
      expect(outcome.fieldErrors).toEqual([]);
    } finally {
      mock.restore();
    }
  });

  it("only fetches campaign when ad_group_id is absent", async () => {
    const config = makeConfig();
    const mock = installFetchMock((url) => {
      if (url.includes("/campaigns/111")) {
        return { status: 200, body: { data: { id: 111, name: "Holiday US" } } };
      }
      return { status: 500, body: "should not be called" };
    });

    try {
      const outcome = await enrichAppleAdsNames(config, { asa_campaign_id: "111" });
      expect(outcome.props).toEqual({ asa_campaign_name: "Holiday US" });
      const apiCalls = mock.calls.filter((c) => c.url.includes("api.searchads.apple.com"));
      expect(apiCalls).toHaveLength(1);
    } finally {
      mock.restore();
    }
  });

  it("treats 404 on ad group as non-fatal (skipped, no field error)", async () => {
    const config = makeConfig();
    const mock = installFetchMock((url) => {
      if (url.includes("/adgroups/222")) return { status: 404, body: "" };
      if (url.includes("/campaigns/111")) {
        return { status: 200, body: { data: { id: 111, name: "Holiday US" } } };
      }
      return { status: 404, body: "" };
    });

    try {
      const outcome = await enrichAppleAdsNames(config, {
        asa_campaign_id: "111",
        asa_ad_group_id: "222",
      });
      expect(outcome.props).toEqual({ asa_campaign_name: "Holiday US" });
      // 404 is not in fieldErrors — only real errors (5xx, network) go there.
      expect(outcome.fieldErrors).toEqual([]);
    } finally {
      mock.restore();
    }
  });

  it("aborts early on an auth error (403) and returns authError", async () => {
    const config = makeConfig();
    const mock = installFetchMock(() => ({ status: 403, body: "forbidden" }));

    try {
      const outcome = await enrichAppleAdsNames(config, {
        asa_campaign_id: "111",
        asa_ad_group_id: "222",
      });
      expect(outcome.props).toEqual({});
      expect(outcome.authError).toBeTruthy();
    } finally {
      mock.restore();
    }
  });

  it("records 5xx as a non-fatal fieldError and keeps resolving other ids", async () => {
    const config = makeConfig();
    const mock = installFetchMock((url) => {
      if (url.includes("/adgroups/222")) return { status: 500, body: "server err" };
      if (url.includes("/campaigns/111")) {
        return { status: 200, body: { data: { id: 111, name: "Holiday US" } } };
      }
      return { status: 404, body: "" };
    });

    try {
      const outcome = await enrichAppleAdsNames(config, {
        asa_campaign_id: "111",
        asa_ad_group_id: "222",
      });
      expect(outcome.props.asa_campaign_name).toBe("Holiday US");
      expect(outcome.props.asa_ad_group_name).toBeUndefined();
      expect(outcome.fieldErrors).toHaveLength(1);
      expect(outcome.fieldErrors[0].field).toBe("ad_group");
      expect(outcome.fieldErrors[0].statusCode).toBe(500);
    } finally {
      mock.restore();
    }
  });
});
