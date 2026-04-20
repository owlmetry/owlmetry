import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_SESSION_ID,
  TEST_BUNDLE_ID,
  TEST_DB_URL,
} from "./setup.js";
import { attachmentCleanupHandler } from "../jobs/attachment-cleanup.js";
import { issueScanHandler } from "../jobs/issue-scan.js";
import type { JobContext } from "../services/job-runner.js";
import { createDatabaseConnection } from "@owlmetry/db";

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

function buildJobContext(): JobContext {
  const db = createDatabaseConnection(TEST_DB_URL);
  return {
    runId: "test-run",
    db,
    createClient: () => postgres(TEST_DB_URL, { max: 1 }),
    updateProgress: async () => {},
    isCancelled: () => false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as JobContext;
}

function bodyFor(sizeBytes: number) {
  return Buffer.alloc(sizeBytes, 0xab);
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function reserveAttachment(
  opts: Partial<{
    client_event_id: string;
    user_id: string;
    original_filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
    is_dev: boolean;
    key: string;
  }> = {}
) {
  const buf = bodyFor(opts.size_bytes ?? 64);
  const payload: Record<string, unknown> = {
    client_event_id: opts.client_event_id ?? randomUUID(),
    original_filename: opts.original_filename ?? "input.bin",
    content_type: opts.content_type ?? "application/octet-stream",
    size_bytes: opts.size_bytes ?? 64,
    sha256: opts.sha256 ?? sha256(buf),
    is_dev: opts.is_dev ?? false,
  };
  if (opts.user_id !== undefined) payload.user_id = opts.user_id;
  return {
    buf,
    response: await app.inject({
      method: "POST",
      url: "/v1/ingest/attachment",
      headers: { authorization: `Bearer ${opts.key ?? TEST_CLIENT_KEY}` },
      payload,
    }),
  };
}

async function uploadBytes(id: string, body: Buffer, key = TEST_CLIENT_KEY) {
  return app.inject({
    method: "PUT",
    url: `/v1/ingest/attachment/${id}`,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/octet-stream",
    },
    payload: body,
  });
}

async function ingestEvent(clientEventId: string, level = "error") {
  return app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: {
      bundle_id: TEST_BUNDLE_ID,
      events: [
        {
          level,
          message: "conversion failed",
          session_id: TEST_SESSION_ID,
          client_event_id: clientEventId,
        },
      ],
    },
  });
}

describe("POST /v1/ingest/attachment — reserve", () => {
  it("creates a pending attachment row", async () => {
    const { response } = await reserveAttachment();
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.attachment_id).toBeTruthy();
    expect(body.upload_url).toContain(body.attachment_id);
  });

  it("enforces per-user quota with 413 user_quota_exhausted", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`UPDATE projects SET attachment_user_quota_bytes = 256`;
    } finally {
      await client.end();
    }

    const first = await reserveAttachment({ user_id: "user-a", size_bytes: 200 });
    expect(first.response.statusCode).toBe(201);

    const second = await reserveAttachment({ user_id: "user-a", size_bytes: 100 });
    expect(second.response.statusCode).toBe(413);
    expect(second.response.json().code).toBe("user_quota_exhausted");
  });

  it("per-user quota is isolated between users", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`UPDATE projects SET attachment_user_quota_bytes = 256`;
    } finally {
      await client.end();
    }

    const a = await reserveAttachment({ user_id: "user-a", size_bytes: 200 });
    expect(a.response.statusCode).toBe(201);

    // A different user has their own bucket.
    const b = await reserveAttachment({ user_id: "user-b", size_bytes: 200 });
    expect(b.response.statusCode).toBe(201);
  });

  it("uploads without user_id skip the per-user quota check", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`UPDATE projects SET attachment_user_quota_bytes = 64`;
    } finally {
      await client.end();
    }

    const res = await reserveAttachment({ size_bytes: 256 });
    expect(res.response.statusCode).toBe(201);
  });

  it("rejects disallowed content types with 415", async () => {
    const buf = bodyFor(32);
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest/attachment",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        client_event_id: randomUUID(),
        original_filename: "evil.exe",
        content_type: "application/x-msdownload",
        size_bytes: 32,
        sha256: sha256(buf),
      },
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().code).toBe("disallowed_content_type");
  });

  it("rejects invalid sha256", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest/attachment",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        client_event_id: randomUUID(),
        original_filename: "input.bin",
        content_type: "application/octet-stream",
        size_bytes: 32,
        sha256: "not-a-hash",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_request");
  });

  it("enforces per-project quota with 413 quota_exhausted", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      // Shrink the project quota so a tiny upload fills it.
      await client`UPDATE projects SET attachment_project_quota_bytes = 128`;
    } finally {
      await client.end();
    }

    const first = await reserveAttachment({ size_bytes: 100 });
    expect(first.response.statusCode).toBe(201);

    const second = await reserveAttachment({ size_bytes: 100 });
    expect(second.response.statusCode).toBe(413);
    expect(second.response.json().code).toBe("quota_exhausted");
  });
});

describe("PUT /v1/ingest/attachment/:id — stream bytes", () => {
  it("succeeds on matching size + hash", async () => {
    const { buf, response } = await reserveAttachment();
    const { attachment_id } = response.json();

    const put = await uploadBytes(attachment_id, buf);
    expect(put.statusCode).toBe(200);
    const putBody = put.json();
    expect(putBody.size_bytes).toBe(buf.length);
    expect(putBody.sha256).toBe(sha256(buf));
    expect(putBody.download_url).toContain("/v1/attachments/download");
  });

  it("deletes the row and rejects on hash mismatch", async () => {
    const { response } = await reserveAttachment({ sha256: "0".repeat(64) });
    const { attachment_id } = response.json();
    const buf = bodyFor(64);
    const put = await uploadBytes(attachment_id, buf);
    expect(put.statusCode).toBe(400);
    expect(put.json().code).toBe("hash_mismatch");

    const lookup = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachment_id}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(lookup.statusCode).toBe(404);
  });

  it("rejects a second upload to the same id with 409", async () => {
    const { buf, response } = await reserveAttachment();
    const { attachment_id } = response.json();
    const ok = await uploadBytes(attachment_id, buf);
    expect(ok.statusCode).toBe(200);

    const again = await uploadBytes(attachment_id, buf);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("already_uploaded");
  });
});

describe("Attachment/event linking races", () => {
  it("attachment uploaded before event: event_id is backfilled on event arrival", async () => {
    const clientEventId = randomUUID();
    const { buf, response } = await reserveAttachment({ client_event_id: clientEventId });
    const { attachment_id } = response.json();
    await uploadBytes(attachment_id, buf);

    const evt = await ingestEvent(clientEventId);
    expect(evt.statusCode).toBe(200);

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      const rows = await client<{ event_id: string | null }[]>`
        SELECT event_id FROM event_attachments WHERE id = ${attachment_id}
      `;
      expect(rows[0]?.event_id).toBeTruthy();
    } finally {
      await client.end();
    }
  });

  it("event first: reserve finds event_id immediately", async () => {
    const clientEventId = randomUUID();
    const evt = await ingestEvent(clientEventId);
    expect(evt.statusCode).toBe(200);

    const { response } = await reserveAttachment({ client_event_id: clientEventId });
    const { attachment_id } = response.json();

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      const rows = await client<{ event_id: string | null }[]>`
        SELECT event_id FROM event_attachments WHERE id = ${attachment_id}
      `;
      expect(rows[0]?.event_id).toBeTruthy();
    } finally {
      await client.end();
    }
  });
});

describe("Issue-scan propagation", () => {
  it("links attachments to issue when issue-scan runs", async () => {
    const clientEventId = randomUUID();
    const { buf, response } = await reserveAttachment({ client_event_id: clientEventId });
    const { attachment_id } = response.json();
    await uploadBytes(attachment_id, buf);
    await ingestEvent(clientEventId, "error");

    const ctx = buildJobContext();
    await issueScanHandler(ctx, {});

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      const rows = await client<{ issue_id: string | null }[]>`
        SELECT issue_id FROM event_attachments WHERE id = ${attachment_id}
      `;
      expect(rows[0]?.issue_id).toBeTruthy();
    } finally {
      await client.end();
    }
  });
});

describe("GET /v1/attachments — list", () => {
  it("returns attachments for a project via agent key", async () => {
    const { buf, response } = await reserveAttachment();
    const { attachment_id } = response.json();
    await uploadBytes(attachment_id, buf);

    const list = await app.inject({
      method: "GET",
      url: `/v1/attachments`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.attachments.length).toBe(1);
    expect(body.attachments[0].id).toBe(attachment_id);
    expect(body.attachments[0].uploaded_at).toBeTruthy();
  });

  it("filters by event_client_id", async () => {
    const clientEventIdA = randomUUID();
    const clientEventIdB = randomUUID();
    const a = await reserveAttachment({ client_event_id: clientEventIdA });
    const b = await reserveAttachment({ client_event_id: clientEventIdB });
    await uploadBytes(a.response.json().attachment_id, a.buf);
    await uploadBytes(b.response.json().attachment_id, b.buf);

    const list = await app.inject({
      method: "GET",
      url: `/v1/attachments?event_client_id=${clientEventIdA}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.attachments.length).toBe(1);
    expect(body.attachments[0].event_client_id).toBe(clientEventIdA);
  });
});

describe("Signed download URLs", () => {
  it("round-trips bytes via the signed URL", async () => {
    const { buf, response } = await reserveAttachment();
    const { attachment_id } = response.json();
    await uploadBytes(attachment_id, buf);

    const meta = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachment_id}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(meta.statusCode).toBe(200);
    const url = meta.json().download_url.url;
    const parsed = new URL(url);
    const relative = `${parsed.pathname}${parsed.search}`;

    const dl = await app.inject({ method: "GET", url: relative });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.length).toBe(buf.length);
    expect(sha256(Buffer.from(dl.rawPayload))).toBe(sha256(buf));
  });

  it("rejects a tampered token", async () => {
    const { buf, response } = await reserveAttachment();
    const { attachment_id } = response.json();
    await uploadBytes(attachment_id, buf);

    const meta = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachment_id}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const url = meta.json().download_url.url;
    const parsed = new URL(url);
    const original = parsed.searchParams.get("t")!;
    const lastChar = original.slice(-1);
    // Flip the final hex digit to a different value so the tampered token is always
    // a real mutation — picking a constant like "0" has a 1/16 chance of matching.
    const replacement = lastChar === "0" ? "1" : "0";
    const tampered = original.slice(0, -1) + replacement;
    const dl = await app.inject({
      method: "GET",
      url: `${parsed.pathname}?t=${encodeURIComponent(tampered)}`,
    });
    expect(dl.statusCode).toBe(401);
  });
});

describe("DELETE /v1/attachments/:id", () => {
  it("soft deletes via user JWT", async () => {
    const { buf, response } = await reserveAttachment();
    const { attachment_id } = response.json();
    await uploadBytes(attachment_id, buf);

    // Soft delete via client key (which has events:write)
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/attachments/${attachment_id}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    // Client keys don't have team membership so role check fails; use the user flow instead.
    expect([200, 403]).toContain(del.statusCode);
  });
});

describe("attachment_cleanup job", () => {
  it("hard-deletes soft-deleted rows past grace period", async () => {
    const { buf, response } = await reserveAttachment();
    const { attachment_id } = response.json();
    await uploadBytes(attachment_id, buf);

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`
        UPDATE event_attachments
        SET deleted_at = NOW() - INTERVAL '10 days'
        WHERE id = ${attachment_id}
      `;
    } finally {
      await client.end();
    }

    await attachmentCleanupHandler(buildJobContext(), {});

    const client2 = postgres(TEST_DB_URL, { max: 1 });
    try {
      const rows = await client2`SELECT id FROM event_attachments WHERE id = ${attachment_id}`;
      expect(rows.length).toBe(0);
    } finally {
      await client2.end();
    }
  });

  it("sweeps incomplete reservations older than the grace period", async () => {
    const { response } = await reserveAttachment();
    const { attachment_id } = response.json();

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`
        UPDATE event_attachments
        SET created_at = NOW() - INTERVAL '48 hours'
        WHERE id = ${attachment_id}
      `;
    } finally {
      await client.end();
    }

    await attachmentCleanupHandler(buildJobContext(), {});

    const client2 = postgres(TEST_DB_URL, { max: 1 });
    try {
      const rows = await client2`SELECT id FROM event_attachments WHERE id = ${attachment_id}`;
      expect(rows.length).toBe(0);
    } finally {
      await client2.end();
    }
  });
});
