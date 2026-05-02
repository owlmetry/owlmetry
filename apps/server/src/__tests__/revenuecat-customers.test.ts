import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchRevenueCatCustomers } from "../utils/revenuecat.js";

const RC_API_KEY = "sk_test_revenuecat_key";
const RC_PROJECT_ID = "proj_test_abc123";

function customer(id: string) {
  return {
    object: "customer",
    id,
    project_id: RC_PROJECT_ID,
    first_seen_at: 1700000000000,
    last_seen_at: 1700100000000,
    last_seen_country: "US",
    last_seen_platform: "iOS",
    last_seen_platform_version: "17.0",
    last_seen_app_version: "1.0.0",
  };
}

describe("fetchRevenueCatCustomers", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedUrls: string[];
  let capturedAuth: (string | null)[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedUrls = [];
    capturedAuth = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockListResponse(body: unknown, status = 200) {
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      capturedUrls.push(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedAuth.push(headers["Authorization"] ?? null);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  it("constructs the list URL with limit and bearer auth, no starting_after on first page", async () => {
    mockListResponse({
      object: "list",
      items: [customer("user_a")],
      next_page: null,
      url: "/v2/projects/proj_test_abc123/customers",
    });

    const result = await fetchRevenueCatCustomers(RC_API_KEY, RC_PROJECT_ID);
    expect(result.status).toBe("found");

    expect(capturedUrls).toHaveLength(1);
    const url = capturedUrls[0];
    expect(url).toContain("api.revenuecat.com/v2/projects/proj_test_abc123/customers");
    expect(url).toContain("limit=100");
    expect(url).not.toContain("starting_after");
    expect(capturedAuth[0]).toBe(`Bearer ${RC_API_KEY}`);
  });

  it("forwards the starting_after cursor and an explicit limit on subsequent pages", async () => {
    mockListResponse({ object: "list", items: [], next_page: null, url: "" });

    await fetchRevenueCatCustomers(RC_API_KEY, RC_PROJECT_ID, {
      startingAfter: "user_a",
      limit: 50,
    });

    expect(capturedUrls[0]).toContain("limit=50");
    expect(capturedUrls[0]).toContain("starting_after=user_a");
  });

  it("parses starting_after out of the next_page URL", async () => {
    mockListResponse({
      object: "list",
      items: [customer("user_a"), customer("user_b")],
      next_page: "/v2/projects/proj_test_abc123/customers?starting_after=user_b&limit=100",
      url: "/v2/projects/proj_test_abc123/customers",
    });

    const result = await fetchRevenueCatCustomers(RC_API_KEY, RC_PROJECT_ID);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.items).toHaveLength(2);
    expect(result.nextStartingAfter).toBe("user_b");
  });

  it("returns nextStartingAfter=null when next_page is null", async () => {
    mockListResponse({
      object: "list",
      items: [customer("user_a")],
      next_page: null,
      url: "",
    });

    const result = await fetchRevenueCatCustomers(RC_API_KEY, RC_PROJECT_ID);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.nextStartingAfter).toBeNull();
  });

  it("URL-encodes the project ID and starting_after to handle special chars", async () => {
    mockListResponse({ object: "list", items: [], next_page: null, url: "" });

    await fetchRevenueCatCustomers(RC_API_KEY, "proj/with:slash", {
      startingAfter: "$RCAnonymousID:abc:def",
    });

    const url = capturedUrls[0];
    // Project ID and cursor with special chars must be URL-encoded.
    expect(url).toContain("proj%2Fwith%3Aslash");
    expect(url).toContain("starting_after=%24RCAnonymousID%3Aabc%3Adef");
  });

  it("returns error result with statusCode and message on non-2xx", async () => {
    mockListResponse(
      { message: "The API key needs at least the customer_information:customers:read permission defined" },
      403,
    );

    const result = await fetchRevenueCatCustomers(RC_API_KEY, RC_PROJECT_ID);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.statusCode).toBe(403);
    expect(result.message).toContain("customer_information:customers:read");
  });

  it("returns nextStartingAfter=null when next_page is malformed", async () => {
    mockListResponse({
      object: "list",
      items: [],
      next_page: "not-a-valid-url-at-all",
      url: "",
    });

    const result = await fetchRevenueCatCustomers(RC_API_KEY, RC_PROJECT_ID);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    // Malformed next_page that lacks a starting_after query → null, no throw.
    expect(result.nextStartingAfter).toBeNull();
  });
});
