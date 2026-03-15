import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { Owl, ScopedOwl } from "../../src/index.js";

describe("Owl", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({ accepted: 1, rejected: 0 }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(async () => {
    await Owl.shutdown();
    globalThis.fetch = originalFetch;
  });

  function getCalls(): Array<{ url: string; init: RequestInit }> {
    const fn = globalThis.fetch as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } };
    return fn.mock.calls.map((c) => ({ url: c.arguments[0] as string, init: c.arguments[1] as RequestInit }));
  }

  function getCallCount(): number {
    const fn = globalThis.fetch as unknown as { mock: { callCount(): number } };
    return fn.mock.callCount();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function parseBody(init: RequestInit): any {
    const body = init.body;
    const headers = init.headers as Record<string, string>;
    if (headers?.["Content-Encoding"] === "gzip") {
      const decompressed = gunzipSync(Buffer.from(body as Uint8Array));
      return JSON.parse(decompressed.toString());
    }
    return JSON.parse(body as string);
  }

  it("silently ignores logging before configure (never throws)", () => {
    // Owl.info should not throw even when not configured
    assert.doesNotThrow(() => Owl.info("hello"));
  });

  it("logs events at all levels after configure", async () => {
    Owl.configure({
      endpoint: "http://localhost:4000",
      apiKey: "owl_client_test_1234567890123456789012345678",
      flushThreshold: 100,
    });

    Owl.info("info msg");
    Owl.debug("debug msg");
    Owl.warn("warn msg");
    Owl.error("error msg");
    Owl.attention("attention msg");
    Owl.tracking("tracking msg");

    await Owl.flush();

    assert.ok(getCallCount() > 0);

    const calls = getCalls();
    const body = parseBody(calls[0].init);
    assert.equal(body.events.length, 6);
    assert.equal(body.events[0].level, "info");
    assert.equal(body.events[0].message, "info msg");
    assert.equal(body.events[0].platform, "server");
    assert.ok(body.events[0].session_id);
    assert.ok(body.events[0].client_event_id);
    assert.ok(body.events[0].timestamp);
  });

  it("withUser creates scoped logger with user_id", async () => {
    Owl.configure({
      endpoint: "http://localhost:4000",
      apiKey: "owl_client_test_1234567890123456789012345678",
      flushThreshold: 100,
    });

    const owl = Owl.withUser("user_123");
    assert.ok(owl instanceof ScopedOwl);

    owl.info("user action", { key: "value" });
    await Owl.flush();

    const body = parseBody(getCalls()[0].init);
    assert.equal(body.events[0].user_id, "user_123");
    assert.deepEqual(body.events[0].custom_attributes, { key: "value" });
  });

  it("truncates attribute values at 200 chars", async () => {
    Owl.configure({
      endpoint: "http://localhost:4000",
      apiKey: "owl_client_test_1234567890123456789012345678",
      flushThreshold: 100,
    });

    const longValue = "x".repeat(300);
    Owl.info("test", { long: longValue });
    await Owl.flush();

    const body = parseBody(getCalls()[0].init);
    assert.equal(body.events[0].custom_attributes.long.length, 200);
  });

  it("coerces non-string attribute values to string", async () => {
    Owl.configure({
      endpoint: "http://localhost:4000",
      apiKey: "owl_client_test_1234567890123456789012345678",
      flushThreshold: 100,
    });

    Owl.info("test", { num: 42, bool: true, nil: null } as Record<string, unknown>);
    await Owl.flush();

    const body = parseBody(getCalls()[0].init);
    assert.equal(body.events[0].custom_attributes.num, "42");
    assert.equal(body.events[0].custom_attributes.bool, "true");
    assert.equal(body.events[0].custom_attributes.nil, "null");
  });

  it("includes appVersion when configured", async () => {
    Owl.configure({
      endpoint: "http://localhost:4000",
      apiKey: "owl_client_test_1234567890123456789012345678",
      appVersion: "1.2.3",
      flushThreshold: 100,
    });

    Owl.info("test");
    await Owl.flush();

    const body = parseBody(getCalls()[0].init);
    assert.equal(body.events[0].app_version, "1.2.3");
  });

  it("does not include bundle_id in request body", async () => {
    Owl.configure({
      endpoint: "http://localhost:4000",
      apiKey: "owl_client_test_1234567890123456789012345678",
      flushThreshold: 100,
    });

    Owl.info("test");
    await Owl.flush();

    const body = parseBody(getCalls()[0].init);
    assert.equal(body.bundle_id, undefined);
  });

  it("generates new session_id on each configure", async () => {
    Owl.configure({
      endpoint: "http://localhost:4000",
      apiKey: "owl_client_test_1234567890123456789012345678",
      flushThreshold: 100,
    });
    Owl.info("first");
    await Owl.flush();

    const firstBody = parseBody(getCalls()[0].init);
    const firstSessionId = firstBody.events[0].session_id;

    await Owl.shutdown();

    Owl.configure({
      endpoint: "http://localhost:4000",
      apiKey: "owl_client_test_1234567890123456789012345678",
      flushThreshold: 100,
    });
    Owl.info("second");
    await Owl.flush();

    const secondBody = parseBody(getCalls()[1].init);
    const secondSessionId = secondBody.events[0].session_id;

    assert.notEqual(firstSessionId, secondSessionId);
  });
});
