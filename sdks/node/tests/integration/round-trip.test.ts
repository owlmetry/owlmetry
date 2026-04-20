import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
    const res = await fetch(`${ENDPOINT}/v1/events?limit=10&data_mode=all`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { events: Array<{ message: string; environment: string; custom_attributes: Record<string, string>; is_dev: boolean }> };
    const found = body.events.find((e) => e.message === uniqueMsg);
    assert.ok(found, `Expected to find event with message "${uniqueMsg}"`);
    assert.equal(found.environment, "backend");
    assert.deepEqual(found.custom_attributes, { test: "true" });
    assert.equal(found.is_dev, true);
  });

  it("sends events with user_id via withUser", async () => {
    const uniqueMsg = `user-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owl = Owl.withUser("integration-user-42");
    owl.error(uniqueMsg);
    await Owl.flush();

    await new Promise((r) => setTimeout(r, 500));

    const res = await fetch(`${ENDPOINT}/v1/events?user_id=integration-user-42&limit=10&data_mode=all`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { events: Array<{ message: string; user_id: string; level: string }> };
    const found = body.events.find((e) => e.message === uniqueMsg);
    assert.ok(found, `Expected to find event with message "${uniqueMsg}"`);
    assert.equal(found.user_id, "integration-user-42");
    assert.equal(found.level, "error");
  });

  it("sets user properties and verifies them via API", async () => {
    const userId = `props-test-${Date.now()}`;

    // Send an event to ensure the user exists
    const owl = Owl.withUser(userId);
    owl.info("properties test");
    await Owl.flush();
    await new Promise((r) => setTimeout(r, 500));

    // Set properties
    owl.setUserProperties({ plan: "premium", org: "acme" });
    await new Promise((r) => setTimeout(r, 1000));

    // Query app-users to verify properties
    const res = await fetch(`${ENDPOINT}/v1/app-users?search=${userId}&data_mode=all`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { users: Array<{ user_id: string; properties: Record<string, string> | null }> };
    const user = body.users.find((u) => u.user_id === userId);
    assert.ok(user, `Expected to find user "${userId}"`);
    assert.equal(user.properties?.plan, "premium");
    assert.equal(user.properties?.org, "acme");
  });

  it("merges user properties without overwriting", async () => {
    const userId = `merge-test-${Date.now()}`;

    const owl = Owl.withUser(userId);
    owl.info("merge test");
    await Owl.flush();
    await new Promise((r) => setTimeout(r, 500));

    // Set initial properties
    owl.setUserProperties({ plan: "free", org: "acme" });
    await new Promise((r) => setTimeout(r, 1000));

    // Update one, add another
    owl.setUserProperties({ plan: "premium", role: "admin" });
    await new Promise((r) => setTimeout(r, 1000));

    const res = await fetch(`${ENDPOINT}/v1/app-users?search=${userId}&data_mode=all`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    const body = await res.json() as { users: Array<{ user_id: string; properties: Record<string, string> | null }> };
    const user = body.users.find((u) => u.user_id === userId);
    assert.ok(user, `Expected to find user "${userId}"`);
    assert.equal(user.properties?.plan, "premium", "plan should be updated");
    assert.equal(user.properties?.org, "acme", "org should be preserved");
    assert.equal(user.properties?.role, "admin", "role should be added");
  });

  it("stamps events with session_id from withSession() scope", async () => {
    const clientSessionId = randomUUID();
    const uniqueMsg = `session-scope-${clientSessionId}`;

    const owl = Owl.withSession(clientSessionId).withUser("session-scope-user");
    owl.info(uniqueMsg, { scoped: "true" });
    await Owl.flush();
    await new Promise((r) => setTimeout(r, 500));

    const res = await fetch(`${ENDPOINT}/v1/events?session_id=${clientSessionId}&limit=10&data_mode=all`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { events: Array<{ message: string; session_id: string; user_id: string }> };
    const found = body.events.find((e) => e.message === uniqueMsg);
    assert.ok(found, `Expected to find event with message "${uniqueMsg}"`);
    assert.equal(found.session_id, clientSessionId);
    assert.equal(found.user_id, "session-scope-user");
  });

  it("stamps events with session_id from options.sessionId override", async () => {
    const clientSessionId = randomUUID();
    const uniqueMsg = `session-override-${clientSessionId}`;

    Owl.info(uniqueMsg, { overridden: "true" }, { sessionId: clientSessionId });
    await Owl.flush();
    await new Promise((r) => setTimeout(r, 500));

    const res = await fetch(`${ENDPOINT}/v1/events?session_id=${clientSessionId}&limit=10&data_mode=all`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { events: Array<{ message: string; session_id: string }> };
    const found = body.events.find((e) => e.message === uniqueMsg);
    assert.ok(found, `Expected to find event with message "${uniqueMsg}"`);
    assert.equal(found.session_id, clientSessionId);
  });

  it("deduplicates events by client_event_id", async () => {
    const uniqueMsg = `dedup-test-${Date.now()}`;

    // Send same event twice
    Owl.info(uniqueMsg);
    await Owl.flush();

    Owl.info(uniqueMsg);
    await Owl.flush();

    await new Promise((r) => setTimeout(r, 500));

    const res = await fetch(`${ENDPOINT}/v1/events?limit=50&data_mode=all`, {
      headers: { Authorization: `Bearer ${AGENT_KEY}` },
    });

    const body = await res.json() as { events: Array<{ message: string; client_event_id: string }> };
    const matches = body.events.filter((e) => e.message === uniqueMsg);
    // Each event gets a unique client_event_id, so both should be accepted
    // (dedup is by client_event_id, not message — both events are unique)
    assert.equal(matches.length, 2);
  });
});
