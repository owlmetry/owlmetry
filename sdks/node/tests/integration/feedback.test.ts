import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Owl } from "../../src/index.js";

const ENDPOINT = process.env.OWLMETRY_TEST_ENDPOINT || "http://127.0.0.1:4112";
const SERVER_KEY = process.env.OWLMETRY_TEST_SERVER_KEY!;
const AGENT_KEY = process.env.OWLMETRY_TEST_AGENT_KEY!;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FeedbackRow = {
  id: string;
  message: string;
  submitter_name: string | null;
  submitter_email: string | null;
  status: string;
  environment: string | null;
  is_dev: boolean;
  user_id: string | null;
  session_id: string | null;
  app_version: string | null;
};

async function fetchFeedbackById(id: string): Promise<FeedbackRow | undefined> {
  const res = await fetch(`${ENDPOINT}/v1/feedback?limit=50&data_mode=all`, {
    headers: { Authorization: `Bearer ${AGENT_KEY}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { feedback: FeedbackRow[] };
  return body.feedback.find((row) => row.id === id);
}

describe("Node SDK sendFeedback integration", () => {
  before(() => {
    Owl.configure({
      endpoint: ENDPOINT,
      apiKey: SERVER_KEY,
      appVersion: "feedback-test-1.0.0",
      serviceName: "feedback-integration-test",
      flushThreshold: 100,
    });
  });

  after(async () => {
    await Owl.shutdown();
  });

  it("submits feedback and returns a receipt that round-trips via the API", async () => {
    const marker = `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const message = `Great app — ${marker}`;

    const receipt = await Owl.sendFeedback(message, {
      name: "Jane Tester",
      email: "jane@example.com",
    });

    assert.match(receipt.id, UUID_REGEX);
    assert.ok(!Number.isNaN(Date.parse(receipt.createdAt)), "createdAt must be ISO-8601");

    await new Promise((r) => setTimeout(r, 300));

    const row = await fetchFeedbackById(receipt.id);
    assert.ok(row, `expected to find feedback row ${receipt.id}`);
    assert.equal(row.message, message);
    assert.equal(row.submitter_name, "Jane Tester");
    assert.equal(row.submitter_email, "jane@example.com");
    assert.equal(row.status, "new");
    assert.equal(row.environment, "backend");
    assert.equal(row.is_dev, true);
    assert.equal(row.app_version, "feedback-test-1.0.0");
  });

  it("rejects empty messages synchronously without hitting the server", async () => {
    await assert.rejects(
      () => Owl.sendFeedback("   "),
      /feedback message is required/,
    );
  });

  it("rejects messages above the 4000-char limit", async () => {
    const tooLong = "x".repeat(4001);
    await assert.rejects(
      () => Owl.sendFeedback(tooLong),
      /at most 4000 characters/,
    );
  });

  it("attaches user_id and session_id from a scoped logger", async () => {
    const userId = `feedback-user-${Date.now()}`;
    const sessionId = randomUUID();
    const message = `scoped feedback ${sessionId}`;

    const owl = Owl.withUser(userId).withSession(sessionId);
    const receipt = await owl.sendFeedback(message);

    await new Promise((r) => setTimeout(r, 300));

    const row = await fetchFeedbackById(receipt.id);
    assert.ok(row, "expected feedback row to be readable");
    assert.equal(row.user_id, userId);
    assert.equal(row.session_id, sessionId);
  });

  it("surfaces server-side validation errors", async () => {
    await assert.rejects(
      () => Owl.sendFeedback("bad email test", { email: "not-an-email" }),
      /submitter_email is not a valid email address/,
    );
  });
});
