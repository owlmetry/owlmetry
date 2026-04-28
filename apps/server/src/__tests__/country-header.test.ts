import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_BACKEND_CLIENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_AGENT_KEY,
} from "./setup.js";
import { parseCountryHeader } from "../utils/event-processing.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || "postgresql://localhost:5432/owlmetry_test";

let app: FastifyInstance;
let dbClient: postgres.Sql;

beforeAll(async () => {
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
});

afterAll(async () => {
  await dbClient.end();
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

  // upsertAppUsers is fire-and-forget from /v1/ingest — poll briefly for
  // the row to materialize. Fast locally, racy on CI.
  async function pollForUser(expectedCountry: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/app-users?search=country-user-1`,
        headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      });
      expect(res.statusCode).toBe(200);
      const user = res.json().users.find((u: { user_id: string }) => u.user_id === "country-user-1");
      if (user?.last_country_code === expectedCountry) return user;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for last_country_code=${expectedCountry}`);
  }

  it("updates app_users.last_country_code", async () => {
    await ingestWithCountry("JP", "country-user-jp");
    const user = await pollForUser("JP");
    expect(user.last_country_code).toBe("JP");
  });

  it("does not wipe last_country_code when a later request has no header", async () => {
    await ingestWithCountry("JP", "first-country-event");
    await ingestWithCountry(undefined, "second-country-event");
    const user = await pollForUser("JP");
    expect(user.last_country_code).toBe("JP");
  });
});

describe("backend apps drop CF-IPCountry", () => {
  async function ingestBackend(country: string | undefined, message: string, userId: string) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${TEST_BACKEND_CLIENT_KEY}`,
    };
    if (country !== undefined) headers["cf-ipcountry"] = country;
    return app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers,
      payload: {
        events: [
          {
            level: "info",
            message,
            session_id: TEST_SESSION_ID,
            environment: "backend",
            user_id: userId,
          },
        ],
      },
    });
  }

  it("ignores CF-IPCountry on /v1/ingest for backend apps", async () => {
    const res = await ingestBackend("DE", "backend-country-de", "backend-user-1");
    expect(res.statusCode).toBe(200);

    const rows = await dbClient`
      SELECT country_code FROM events WHERE message = 'backend-country-de'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].country_code).toBeNull();
  });

  it("does not stamp last_country_code on app_users for backend apps", async () => {
    await ingestBackend("DE", "backend-user-event", "backend-user-2");

    // upsertAppUsers is fire-and-forget — poll until the row materializes.
    let row: { last_country_code: string | null } | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await dbClient<{ last_country_code: string | null }[]>`
        SELECT last_country_code FROM app_users WHERE user_id = 'backend-user-2'
      `;
      if (rows.length > 0) {
        row = rows[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(row).toBeDefined();
    expect(row?.last_country_code).toBeNull();
  });
});
