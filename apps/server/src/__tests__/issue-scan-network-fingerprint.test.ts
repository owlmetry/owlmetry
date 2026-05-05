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

interface NetworkErrorEvent {
  url: string;
  method?: string;
  session_id?: string;
  source_module?: string;
  message?: string;
  custom_attributes?: Record<string, string>;
}

async function ingestNetworkErrors(events: NetworkErrorEvent[]) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: {
      bundle_id: TEST_BUNDLE_ID,
      events: events.map((e, i) => ({
        level: "error",
        message: e.message ?? "sdk:network_request",
        source_module: e.source_module ?? "Net",
        session_id: e.session_id ?? `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
        custom_attributes: e.custom_attributes ?? {
          _http_method: e.method ?? "GET",
          _http_url: e.url,
        },
      })),
    },
  });
  expect(res.statusCode).toBe(200);
}

async function runScan() {
  const handler = issueScanHandler(app.notificationDispatcher);
  return handler(makeJobContext(), {});
}

async function listIssues() {
  return dbClient<{ id: string; title: string }[]>`
    SELECT id, title FROM issues WHERE app_id = ${appId} ORDER BY created_at ASC
  `;
}

describe("issue_scan splits sdk:network_request errors by host+path+method", () => {
  it("creates separate issues for different hosts", async () => {
    await ingestNetworkErrors([
      { url: "https://api.revenuecat.com/v1/subscribers" },
      { url: "https://api.example.com/v1/users" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(2);

    const rows = await listIssues();
    expect(rows).toHaveLength(2);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual([
      "Network error: GET api.example.com/v1/users",
      "Network error: GET api.revenuecat.com/v1/subscribers",
    ]);
  });

  it("creates separate issues for different paths on the same host", async () => {
    await ingestNetworkErrors([
      { url: "https://api.foo.com/v1/users" },
      { url: "https://api.foo.com/v1/orders" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(2);
  });

  it("creates separate issues for different methods on the same endpoint", async () => {
    await ingestNetworkErrors([
      { url: "https://api.foo.com/v1/users", method: "GET" },
      { url: "https://api.foo.com/v1/users", method: "POST" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(2);
  });

  it("groups errors with the same host+path even when path contains numeric IDs", async () => {
    await ingestNetworkErrors([
      { url: "https://api.foo.com/v1/users/123" },
      { url: "https://api.foo.com/v1/users/456" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
    const rows = await listIssues();
    expect(rows[0].title).toBe("Network error: GET api.foo.com/v1/users/<n>");
  });

  it("groups errors with the same host+path even when path contains UUIDs", async () => {
    await ingestNetworkErrors([
      { url: "https://api.foo.com/v1/sessions/550e8400-e29b-41d4-a716-446655440000" },
      { url: "https://api.foo.com/v1/sessions/6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
    const rows = await listIssues();
    expect(rows[0].title).toBe("Network error: GET api.foo.com/v1/sessions/<uuid>");
  });

  it("falls back to single-issue grouping when _http_url is malformed", async () => {
    await ingestNetworkErrors([
      {
        url: "ignored",
        custom_attributes: { _http_method: "GET", _http_url: "not a url" },
      },
      {
        url: "ignored",
        custom_attributes: { _http_method: "POST", _http_url: "also-bad" },
      },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
    const rows = await listIssues();
    expect(rows[0].title).toBe("sdk:network_request");
  });

  it("falls back to single-issue grouping when custom_attributes is missing", async () => {
    await ingestNetworkErrors([
      { url: "ignored", custom_attributes: {} },
      { url: "ignored", custom_attributes: {} },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
    const rows = await listIssues();
    expect(rows[0].title).toBe("sdk:network_request");
  });

  it("groups errors with the same host+path even when path contains Firebase-style alphanumeric IDs", async () => {
    // Real production data: every RevenueCat error embeds a 28-char Firebase
    // UID in /v1/subscribers/{uid}/offerings. Without tokeny templating each
    // affected user would create their own issue (e.g. 31 issues for 3DKit's
    // current single sdk:network_request issue).
    await ingestNetworkErrors([
      { url: "https://api.revenuecat.com/v1/subscribers/qK2nM9lB8JaAfXtKf4EhN2l7yqF3/offerings" },
      { url: "https://api.revenuecat.com/v1/subscribers/WvANm2hmnob5bTZR1Tn7uK7KA0r2/offerings" },
      { url: "https://api.revenuecat.com/v1/subscribers/CdiT9JHLpyMNQhYkujQmKEUxQy63/offerings" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
    const rows = await listIssues();
    expect(rows[0].title).toBe(
      "Network error: GET api.revenuecat.com/v1/subscribers/<id>/offerings",
    );
  });

  it("splits Firebase-UID URLs by trailing path even though the UID itself templates", async () => {
    // Same production fixture but two different RevenueCat endpoints — should
    // still split, proving the tokeny templating doesn't over-collapse.
    await ingestNetworkErrors([
      { url: "https://api.revenuecat.com/v1/subscribers/qK2nM9lB8JaAfXtKf4EhN2l7yqF3/offerings" },
      { url: "https://api.revenuecat.com/v1/subscribers/qK2nM9lB8JaAfXtKf4EhN2l7yqF3" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(2);
    const titles = (await listIssues()).map((r) => r.title).sort();
    expect(titles).toEqual([
      "Network error: GET api.revenuecat.com/v1/subscribers/<id>",
      "Network error: GET api.revenuecat.com/v1/subscribers/<id>/offerings",
    ]);
  });

  it("groups owl_anon_<uuid> path segments together", async () => {
    // Real production data: anonymous user IDs look like
    // owl_anon_FE631B1B-0F18-4F20-8018-896D0F5CF86F. The UUID rule strips
    // the UUID portion; the prefix is identical across users, so all anon
    // requests to the same endpoint collapse into one issue.
    await ingestNetworkErrors([
      { url: "https://api.example.com/v1/users/owl_anon_FE631B1B-0F18-4F20-8018-896D0F5CF86F/profile" },
      { url: "https://api.example.com/v1/users/owl_anon_9512F3B3-1A4C-4EEA-A00F-83B9BFE7C296/profile" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });

  it("does not over-collapse: long all-letter path segments stay distinct", async () => {
    // metrics-aggregator vs feedback-service: both are 17+ chars, no digits.
    // Tokeny rule requires a digit, so these segments are kept verbatim and
    // produce separate issues. Guards against templating real endpoint names.
    await ingestNetworkErrors([
      { url: "https://api.example.com/metrics-aggregator/run" },
      { url: "https://api.example.com/feedback-service/submit" },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(2);
  });

  it("groups Stripe IDs (cus_*, sub_*, pi_*) by endpoint", async () => {
    // Real Stripe ID format: prefix + base62 random. Both samples contain
    // digits so the digit-required guard catches them.
    await ingestNetworkErrors([
      { url: "https://api.stripe.com/v1/customers/cus_NeoLiP9XJTU8RB" },
      { url: "https://api.stripe.com/v1/customers/cus_MhSXdrgeUGN0U2" },
    ]);
    const result = await runScan();
    expect(result.issues_created).toBe(1);
    const rows = await listIssues();
    expect(rows[0].title).toBe("Network error: GET api.stripe.com/v1/customers/<id>");
  });

  it("groups MongoDB ObjectIds by endpoint", async () => {
    await ingestNetworkErrors([
      { url: "https://api.example.com/api/users/507f1f77bcf86cd799439011" },
      { url: "https://api.example.com/api/users/507f191e810c19729de860ea" },
    ]);
    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });

  it("groups Cuid/Cuid2, Nanoid, and ULID IDs by endpoint", async () => {
    // Cuid2: clh3z9b3v0000356xqx2x3qj9 (25 chars), Nanoid: V1StGXR8_Z5jdHi6B-myT (21 chars),
    // ULID: 01F8MECHZX3TBDSZ7XR8YS6Z6X (26 chars). Three different generators, same endpoint.
    await ingestNetworkErrors([
      { url: "https://api.example.com/v1/items/clh3z9b3v0000356xqx2x3qj9" },
      { url: "https://api.example.com/v1/items/V1StGXR8_Z5jdHi6B-myT" },
      { url: "https://api.example.com/v1/items/01F8MECHZX3TBDSZ7XR8YS6Z6X" },
    ]);
    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });

  it("groups Auth0 sub claims (URL-encoded pipe) by endpoint", async () => {
    // auth0|507f1f77bcf86cd799439011 → URL-encoded as auth0%7C... in the path.
    // Per-segment URL-decoding catches these even though %7C splits the
    // [A-Za-z0-9_-] character class.
    await ingestNetworkErrors([
      { url: "https://api.example.com/v1/users/auth0%7C507f1f77bcf86cd799439011" },
      { url: "https://api.example.com/v1/users/auth0%7C507f191e810c19729de860ea" },
    ]);
    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });

  it("groups did:plc:* DIDs (Bluesky-style) by endpoint", async () => {
    await ingestNetworkErrors([
      { url: "https://api.example.com/at/did:plc:abc123def456ghi789" },
      { url: "https://api.example.com/at/did:plc:xyz789uvw012mno345" },
    ]);
    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });

  it("does not collapse short alphabetic slugs (< 12 chars)", async () => {
    // Short, all-letter slugs are likely real distinct resource names. Keep them.
    // (Short slugs containing numbers DO collapse via the final normalizer's
    // \b\d+\b rule — that's intentional, see test below.)
    await ingestNetworkErrors([
      { url: "https://api.example.com/items/foo-bar" },
      { url: "https://api.example.com/items/baz-qux" },
    ]);
    const result = await runScan();
    expect(result.issues_created).toBe(2);
  });

  it("collapses short slugs whose digit suffix is the only difference", async () => {
    // sku-12345 and sku-67890: under the 12-char tokeny threshold so the
    // path-segment template keeps them, but the fingerprint's downstream
    // \b\d+\b normalization (in normalizeErrorMessage) strips the trailing
    // digits. Net effect: numeric-suffix variants collapse, which is the
    // right call for fingerprinting.
    await ingestNetworkErrors([
      { url: "https://api.example.com/items/sku-12345" },
      { url: "https://api.example.com/items/sku-67890" },
    ]);
    const result = await runScan();
    expect(result.issues_created).toBe(1);
  });

  it("handles the real RevenueCat + Firebase logging cascade in one session", async () => {
    // Mirrors a real FaxApp offline session: 3 distinct endpoints fail
    // (two different RC paths + Firebase batchlog). Burst aliasing collapses
    // them onto a single issue (same session, same 5s window) and the title
    // is taken from a non-specialized event in the burst — here the first
    // RevenueCat URL.
    const sharedSession = "00000000-0000-0000-0000-bbb000000001";
    await ingestNetworkErrors([
      { url: "https://api.revenuecat.com/v1/subscribers/qK2nM9lB8JaAfXtKf4EhN2l7yqF3/offerings", session_id: sharedSession },
      { url: "https://api.revenuecat.com/v1/subscribers/qK2nM9lB8JaAfXtKf4EhN2l7yqF3", session_id: sharedSession },
      { url: "https://firebaselogging-pa.googleapis.com/v1/firelog/legacy/batchlog", method: "POST", session_id: sharedSession },
    ]);

    const result = await runScan();
    // Burst aliasing: one issue for the cascade. All three fingerprints
    // alias onto it (verified via fingerprints[].length below).
    expect(result.issues_created).toBe(1);
    const [row] = await dbClient<{ id: string; title: string; fingerprints: unknown }[]>`
      SELECT i.id, i.title,
        (SELECT array_agg(fingerprint) FROM issue_fingerprints WHERE issue_id = i.id) AS fingerprints
      FROM issues i
      WHERE app_id = ${appId}
    `;
    expect((row.fingerprints as string[]).length).toBe(3);
  });

  it("does not split non-network errors that share a message", async () => {
    await ingestNetworkErrors([
      {
        url: "ignored",
        message: "TypeError: oops",
        source_module: "Foo",
        custom_attributes: { _http_method: "GET", _http_url: "https://a.com/x" },
        session_id: "00000000-0000-0000-0000-aaa000000001",
      },
      {
        url: "ignored",
        message: "TypeError: oops",
        source_module: "Foo",
        custom_attributes: { _http_method: "POST", _http_url: "https://b.com/y" },
        session_id: "00000000-0000-0000-0000-aaa000000002",
      },
    ]);

    const result = await runScan();
    expect(result.issues_created).toBe(1);
    const rows = await listIssues();
    expect(rows[0].title).toBe("TypeError: oops");
  });
});
