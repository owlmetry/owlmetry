import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { issueScanHandler } from "../jobs/issue-scan.js";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  makeJobContext,
  TEST_CLIENT_KEY,
  TEST_BUNDLE_ID,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let appId: string;

beforeAll(async () => {
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await dbClient.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
  await getTokenAndTeamId(app);
  const [appRow] = await dbClient`
    SELECT id FROM apps WHERE bundle_id = ${TEST_BUNDLE_ID}
  `;
  appId = appRow.id;
});

interface ErrorEventInput {
  message: string;
  source_module?: string;
  session_id?: string;
  custom_attributes?: Record<string, string>;
}

async function ingestErrors(events: ErrorEventInput[]) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: {
      bundle_id: TEST_BUNDLE_ID,
      events: events.map((e, i) => ({
        level: "error",
        message: e.message,
        source_module: e.source_module ?? "App",
        session_id: e.session_id ?? `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
        custom_attributes: e.custom_attributes,
      })),
    },
  });
  expect(res.statusCode).toBe(200);
}

async function runScan() {
  const handler = issueScanHandler(app.notificationDispatcher);
  return handler(makeJobContext(), {});
}

describe("issue_scan splits errors by _error_type", () => {
  it("creates separate issues for same message, different error types", async () => {
    await ingestErrors([
      {
        message: "operation failed",
        source_module: "Foo",
        custom_attributes: { _error_type: "TypeError" },
      },
      {
        message: "operation failed",
        source_module: "Foo",
        custom_attributes: { _error_type: "RangeError" },
      },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(2);
  });

  it("groups events with same message + same error type", async () => {
    await ingestErrors([
      {
        message: "operation failed",
        source_module: "Foo",
        custom_attributes: { _error_type: "TypeError", other: "a" },
      },
      {
        message: "operation failed",
        source_module: "Foo",
        custom_attributes: { _error_type: "TypeError", other: "b" },
      },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });

  it("preserves legacy fingerprint for events without _error_type", async () => {
    // Two events with no _error_type — must group as before (legacy 2-arg
    // fingerprint), so existing rows aren't disturbed by the new code path.
    await ingestErrors([
      { message: "operation failed", source_module: "Foo" },
      { message: "operation failed", source_module: "Foo" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });

  it("an error_type-tagged event and a plain event with the same message do not collide", async () => {
    // The discriminator in the tagged event makes its fingerprint distinct
    // from the legacy 2-arg fingerprint of the untagged one.
    await ingestErrors([
      {
        message: "operation failed",
        source_module: "Foo",
        custom_attributes: { _error_type: "TypeError" },
      },
      { message: "operation failed", source_module: "Foo" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(2);
  });

  it("network_request errors stay on the network discriminator (not error_type)", async () => {
    // Network branch wins — the host/path discriminator is more specific.
    await ingestErrors([
      {
        message: "sdk:network_request",
        source_module: "Net",
        custom_attributes: {
          _http_method: "GET",
          _http_url: "https://api.foo.com/v1/users",
          _error_type: "URLError",
        },
      },
      {
        message: "sdk:network_request",
        source_module: "Net",
        custom_attributes: {
          _http_method: "GET",
          _http_url: "https://api.foo.com/v1/users",
          _error_type: "TypeError",
        },
      },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });
});
