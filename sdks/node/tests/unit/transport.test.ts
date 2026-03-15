import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { Transport } from "../../src/transport.js";
import type { ValidatedConfig } from "../../src/configuration.js";
import type { LogEvent } from "../../src/types.js";

function makeConfig(overrides?: Partial<ValidatedConfig>): ValidatedConfig {
  return {
    endpoint: "http://localhost:4000",
    apiKey: "owl_server_test_1234567890123456789012345678",
    serviceName: "test",
    debug: false,
    flushIntervalMs: 60000,
    flushThreshold: 5,
    maxBufferSize: 100,
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<LogEvent>): LogEvent {
  return {
    client_event_id: "evt-1",
    session_id: "sess-1",
    level: "info",
    message: "test event",
    platform: "server",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("Transport", () => {
  let transport: Transport;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    if (transport) await transport.shutdown();
    globalThis.fetch = originalFetch;
  });

  it("buffers events", () => {
    transport = new Transport(makeConfig());
    transport.enqueue(makeEvent());
    transport.enqueue(makeEvent({ client_event_id: "evt-2" }));
    assert.equal(transport.bufferSize, 2);
  });

  it("drops oldest when buffer exceeds maxBufferSize", () => {
    transport = new Transport(makeConfig({ maxBufferSize: 3, flushThreshold: 100 }));

    transport.enqueue(makeEvent({ client_event_id: "evt-1" }));
    transport.enqueue(makeEvent({ client_event_id: "evt-2" }));
    transport.enqueue(makeEvent({ client_event_id: "evt-3" }));
    transport.enqueue(makeEvent({ client_event_id: "evt-4" }));

    assert.equal(transport.bufferSize, 3);
  });

  it("clears buffer on shutdown", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({ accepted: 1, rejected: 0 }), { status: 200 });
    }) as unknown as typeof fetch;

    transport = new Transport(makeConfig());
    transport.enqueue(makeEvent());
    await transport.shutdown();

    assert.equal(transport.bufferSize, 0);
    const fn = globalThis.fetch as unknown as { mock: { callCount(): number } };
    assert.ok(fn.mock.callCount() > 0, "should have called fetch");
  });

  it("clears timer on shutdown", async () => {
    transport = new Transport(makeConfig());
    await transport.shutdown();
    // Verify no error when shutting down again
    await transport.shutdown();
  });
});
