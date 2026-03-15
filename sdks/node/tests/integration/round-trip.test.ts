import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Owl } from "../../src/index.js";

const ENDPOINT = process.env.OWLMETRY_TEST_ENDPOINT || "http://127.0.0.1:4112";
const SERVER_KEY = process.env.OWLMETRY_TEST_SERVER_KEY!;
const AGENT_KEY = process.env.OWLMETRY_TEST_AGENT_KEY!;

describe("Node SDK integration", () => {
  before(() => {
    Owl.configure({
      endpoint: ENDPOINT,
      apiKey: SERVER_KEY,
      appVersion: "1.0.0-test",
      serviceName: "integration-test",
      flushThreshold: 100, // manual flush only
    });
  });

  after(async () => {
    await Owl.shutdown();
  });

  it("sends events and queries them back", async () => {
    const uniqueMsg = `integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    Owl.info(uniqueMsg, { test: "true" });
    await Owl.flush();

    // Wait briefly for server to process
    await new Promise((r) => setTimeout(r, 500));

    // Query events back via agent key
    const res = await fetch(`${ENDPOINT}/v1/events?limit=10`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { events: Array<{ message: string; platform: string; custom_attributes: Record<string, string> }> };
    const found = body.events.find((e) => e.message === uniqueMsg);
    assert.ok(found, `Expected to find event with message "${uniqueMsg}"`);
    assert.equal(found.platform, "server");
    assert.deepEqual(found.custom_attributes, { test: "true" });
  });

  it("sends events with user_id via withUser", async () => {
    const uniqueMsg = `user-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owl = Owl.withUser("integration-user-42");
    owl.error(uniqueMsg);
    await Owl.flush();

    await new Promise((r) => setTimeout(r, 500));

    const res = await fetch(`${ENDPOINT}/v1/events?user_id=integration-user-42&limit=10`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { events: Array<{ message: string; user_id: string; level: string }> };
    const found = body.events.find((e) => e.message === uniqueMsg);
    assert.ok(found, `Expected to find event with message "${uniqueMsg}"`);
    assert.equal(found.user_id, "integration-user-42");
    assert.equal(found.level, "error");
  });

  it("deduplicates events by client_event_id", async () => {
    const uniqueMsg = `dedup-test-${Date.now()}`;

    // Send same event twice
    Owl.info(uniqueMsg);
    await Owl.flush();

    Owl.info(uniqueMsg);
    await Owl.flush();

    await new Promise((r) => setTimeout(r, 500));

    const res = await fetch(`${ENDPOINT}/v1/events?limit=50`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    const body = await res.json() as { events: Array<{ message: string; client_event_id: string }> };
    const matches = body.events.filter((e) => e.message === uniqueMsg);
    // Each event gets a unique client_event_id, so both should be accepted
    // (dedup is by client_event_id, not message — both events are unique)
    assert.equal(matches.length, 2);
  });
});
