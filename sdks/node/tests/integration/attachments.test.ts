import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Owl } from "../../src/index.js";
import { AttachmentUploader } from "../../src/attachment-uploader.js";
import { validateConfiguration } from "../../src/configuration.js";

const ENDPOINT = process.env.OWLMETRY_TEST_ENDPOINT || "http://127.0.0.1:4112";
const SERVER_KEY = process.env.OWLMETRY_TEST_SERVER_KEY!;
const AGENT_KEY = process.env.OWLMETRY_TEST_AGENT_KEY!;

interface EventRow {
  message: string;
  client_event_id: string;
}

interface AttachmentRow {
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_at: string | null;
}

async function queryEvents(params: URLSearchParams): Promise<EventRow[]> {
  params.set("data_mode", "all");
  const res = await fetch(`${ENDPOINT}/v1/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${AGENT_KEY}` },
  });
  assert.equal(res.status, 200, `events query failed: ${res.status}`);
  const body = (await res.json()) as { events: EventRow[] };
  return body.events;
}

async function queryAttachments(eventClientId: string): Promise<AttachmentRow[]> {
  const res = await fetch(
    `${ENDPOINT}/v1/attachments?event_client_id=${encodeURIComponent(eventClientId)}`,
    { headers: { Authorization: `Bearer ${AGENT_KEY}` } },
  );
  assert.equal(res.status, 200, `attachments query failed: ${res.status}`);
  const body = (await res.json()) as { attachments: AttachmentRow[] };
  return body.attachments;
}

async function waitForAttachments(
  eventClientId: string,
  expectedCount: number,
  timeoutMs = 10_000,
): Promise<AttachmentRow[]> {
  const deadline = Date.now() + timeoutMs;
  let attachments: AttachmentRow[] = [];
  while (Date.now() < deadline) {
    attachments = await queryAttachments(eventClientId);
    const uploaded = attachments.filter((a) => a.uploaded_at !== null);
    if (uploaded.length >= expectedCount) return attachments;
    await new Promise((r) => setTimeout(r, 300));
  }
  return attachments;
}

async function findEventClientId(messageMatch: string, maxWaitMs = 3_000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const events = await queryEvents(new URLSearchParams({ limit: "20" }));
    const found = events.find((e) => e.message === messageMatch);
    if (found) return found.client_event_id;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out finding event with message "${messageMatch}"`);
}

describe("Node SDK attachments", () => {
  before(() => {
    Owl.configure({
      endpoint: ENDPOINT,
      apiKey: SERVER_KEY,
      appVersion: "1.0.0-test",
      serviceName: "attachments-test",
      flushThreshold: 100,
    });
  });

  after(async () => {
    await Owl.shutdown();
  });

  it("uploads an attachment from a Buffer", async () => {
    const payload = Buffer.from("hello bytes");
    const message = `attach-buffer-${randomUUID()}`;

    Owl.error(message, { stage: "test" }, {
      attachments: [{ buffer: payload, name: "hello.txt", contentType: "text/plain" }],
    });
    await Owl.flush();

    const clientEventId = await findEventClientId(message);
    const attachments = await waitForAttachments(clientEventId, 1);

    assert.equal(attachments.length, 1);
    const a = attachments[0];
    assert.equal(a.original_filename, "hello.txt");
    assert.equal(a.content_type, "text/plain");
    assert.equal(a.size_bytes, payload.byteLength);
    assert.ok(a.uploaded_at, "attachment should be uploaded (uploaded_at set)");
    const expectedSha = createHash("sha256").update(payload).digest("hex");
    assert.equal(a.sha256, expectedSha);
  });

  it("uploads an attachment from a file path and infers the filename + MIME", async () => {
    const dir = mkdtempSync(join(tmpdir(), "owl-attach-"));
    const filename = "report.log";
    const filepath = join(dir, filename);
    const payload = Buffer.from("file-based attachment");
    writeFileSync(filepath, payload);

    try {
      const message = `attach-path-${randomUUID()}`;
      Owl.error(message, {}, { attachments: [{ path: filepath }] });
      await Owl.flush();

      const clientEventId = await findEventClientId(message);
      const attachments = await waitForAttachments(clientEventId, 1);

      assert.equal(attachments.length, 1);
      const a = attachments[0];
      assert.equal(a.original_filename, filename);
      assert.equal(a.content_type, "text/plain", ".log should infer text/plain");
      assert.equal(a.size_bytes, payload.byteLength);
      assert.ok(a.uploaded_at);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uploads multiple attachments on a single event", async () => {
    const message = `attach-multi-${randomUUID()}`;
    Owl.error(message, {}, {
      attachments: [
        { buffer: Buffer.from("first"), name: "a.txt", contentType: "text/plain" },
        { buffer: Buffer.from("second"), name: "b.txt", contentType: "text/plain" },
      ],
    });
    await Owl.flush();

    const clientEventId = await findEventClientId(message);
    const attachments = await waitForAttachments(clientEventId, 2);

    assert.equal(attachments.length, 2);
    const names = new Set(attachments.map((a) => a.original_filename));
    assert.deepEqual(names, new Set(["a.txt", "b.txt"]));
  });

  it("Owl.flush() awaits pending attachment uploads", async () => {
    // After flush() resolves, the PUT must already have completed — no polling.
    const payload = Buffer.from("flush-proves-await");
    const message = `attach-flush-${randomUUID()}`;

    Owl.error(message, {}, {
      attachments: [{ buffer: payload, name: "flush.bin", contentType: "application/octet-stream" }],
    });
    await Owl.flush();

    const clientEventId = await findEventClientId(message);
    const attachments = await queryAttachments(clientEventId);
    assert.equal(attachments.length, 1);
    assert.ok(attachments[0].uploaded_at, "attachment should already be uploaded after flush() returns");
  });

  it("skips empty attachments client-side", async () => {
    // Drive the uploader directly with a known client_event_id so we can assert absence
    // without racing the event-ingest pipeline. Covers the size-0 guard in
    // AttachmentUploader.uploadOne.
    const cfg = validateConfiguration({
      endpoint: ENDPOINT,
      apiKey: SERVER_KEY,
      appVersion: "1.0.0-test",
      serviceName: "attachments-test",
    });
    const uploader = new AttachmentUploader(cfg);

    const clientEventId = randomUUID();
    uploader.enqueue(clientEventId, undefined, true, [
      { buffer: Buffer.alloc(0), name: "empty.bin", contentType: "application/octet-stream" },
    ]);
    await uploader.flush();

    const attachments = await queryAttachments(clientEventId);
    assert.equal(attachments.length, 0, "empty attachment should be skipped client-side");
  });
});
