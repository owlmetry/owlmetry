import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_AGENT_KEY,
} from "./setup.js";
import { parseCountryHeader } from "../utils/event-processing.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
});

afterAll(async () => {
  await app.close();
});

describe("parseCountryHeader", () => {
  it("accepts well-formed 2-letter codes", () => {
    expect(parseCountryHeader("DE")).toBe("DE");
    expect(parseCountryHeader("us")).toBe("US");
    expect(parseCountryHeader("  jp  ")).toBe("JP");
  });

  it("returns null for Cloudflare sentinels", () => {
    expect(parseCountryHeader("XX")).toBeNull();
    expect(parseCountryHeader("T1")).toBeNull();
  });

  it("returns null for missing or malformed values", () => {
    expect(parseCountryHeader(undefined)).toBeNull();
    expect(parseCountryHeader("")).toBeNull();
    expect(parseCountryHeader("USA")).toBeNull();
    expect(parseCountryHeader("1A")).toBeNull();
    expect(parseCountryHeader("A")).toBeNull();
  });

  it("handles array header values (uses first)", () => {
    expect(parseCountryHeader(["DE", "FR"])).toBe("DE");
  });
});

describe("CF-IPCountry ingest round-trip", () => {
  async function ingestWithCountry(country: string | undefined, message: string) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${TEST_CLIENT_KEY}`,
    };
    if (country !== undefined) headers["cf-ipcountry"] = country;
    return app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers,
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          {
            level: "info",
            message,
            session_id: TEST_SESSION_ID,
            user_id: "country-user-1",
          },
        ],
      },
    });
  }

  async function queryEvents(message: string) {
    const res = await app.inject({
      method: "GET",
      url: `/v1/events?limit=10`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const body = res.json();
    return body.events.find((e: { message: string }) => e.message === message);
  }

  it("stamps country_code on events when CF-IPCountry is set", async () => {
    const res = await ingestWithCountry("DE", "country-test-de");
    expect(res.statusCode).toBe(200);
    const event = await queryEvents("country-test-de");
    expect(event?.country_code).toBe("DE");
  });

  it("normalizes lowercase header to uppercase", async () => {
    const res = await ingestWithCountry("fr", "country-test-fr");
    expect(res.statusCode).toBe(200);
    const event = await queryEvents("country-test-fr");
    expect(event?.country_code).toBe("FR");
  });

  it("leaves country_code null for XX", async () => {
    const res = await ingestWithCountry("XX", "country-test-xx");
    expect(res.statusCode).toBe(200);
    const event = await queryEvents("country-test-xx");
    expect(event?.country_code).toBeNull();
  });

  it("leaves country_code null for T1 (Tor)", async () => {
    const res = await ingestWithCountry("T1", "country-test-t1");
    expect(res.statusCode).toBe(200);
    const event = await queryEvents("country-test-t1");
    expect(event?.country_code).toBeNull();
  });

  it("leaves country_code null when header is missing", async () => {
    const res = await ingestWithCountry(undefined, "country-test-none");
    expect(res.statusCode).toBe(200);
    const event = await queryEvents("country-test-none");
    expect(event?.country_code).toBeNull();
  });

  it("updates app_users.last_country_code", async () => {
    await ingestWithCountry("JP", "country-user-jp");
    const res = await app.inject({
      method: "GET",
      url: `/v1/app-users?search=country-user-1`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const user = res.json().users.find((u: { user_id: string }) => u.user_id === "country-user-1");
    expect(user?.last_country_code).toBe("JP");
  });

  it("does not wipe last_country_code when a later request has no header", async () => {
    await ingestWithCountry("JP", "first-country-event");
    await ingestWithCountry(undefined, "second-country-event");

    const res = await app.inject({
      method: "GET",
      url: `/v1/app-users?search=country-user-1`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const user = res.json().users.find((u: { user_id: string }) => u.user_id === "country-user-1");
    expect(user?.last_country_code).toBe("JP");
  });
});
