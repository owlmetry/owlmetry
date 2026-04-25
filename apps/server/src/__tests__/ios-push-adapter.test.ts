import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  TEST_DB_URL,
} from "./setup.js";
import { createIosPushAdapter } from "../services/notifications/adapters/ios-push.js";
import type { ApnsClient } from "../utils/apns/client.js";
import type { ChannelDeliveryContext } from "../services/notifications/types.js";

interface RecordedPush {
  token: string;
  alertTitle: string;
}

function makeStubClient(): { client: ApnsClient; calls: RecordedPush[] } {
  const calls: RecordedPush[] = [];
  const client = {
    async push(token: string, payload: { alert: { title: string } }) {
      calls.push({ token, alertTitle: payload.alert.title });
      return { status: "delivered", apnsId: "stub-apns-id" } as const;
    },
    close() {},
  } as unknown as ApnsClient;
  return { client, calls };
}

let app: FastifyInstance;
let dbClient: postgres.Sql;
let ownerUserId: string;

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
  const [owner] = await dbClient`SELECT id FROM users WHERE email = 'test@owlmetry.com'`;
  ownerUserId = owner.id;
});

describe("createIosPushAdapter", () => {
  it("routes each device to the client matching its environment", async () => {
    await dbClient`
      INSERT INTO user_devices (user_id, channel, token, environment) VALUES
        (${ownerUserId}, 'ios_push', 'sandbox-token-aaa', 'sandbox'),
        (${ownerUserId}, 'ios_push', 'production-token-bbb', 'production')
    `;

    const sandbox = makeStubClient();
    const production = makeStubClient();
    const adapter = createIosPushAdapter({ sandbox: sandbox.client, production: production.client });

    const result = await adapter.deliver({
      db: app.db,
      notificationId: "00000000-0000-0000-0000-0000000000aa",
      deliveryId: "00000000-0000-0000-0000-0000000000bb",
      userId: ownerUserId,
      userEmail: "test@owlmetry.com",
      type: "feedback.new",
      payload: { title: "Mixed env", body: "hi", link: "/dashboard/feedback/x" },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.status).toBe("sent");
    expect(sandbox.calls).toEqual([{ token: "sandbox-token-aaa", alertTitle: "Mixed env" }]);
    expect(production.calls).toEqual([{ token: "production-token-bbb", alertTitle: "Mixed env" }]);
  });

  it("routes only sandbox-tagged devices through the sandbox client", async () => {
    await dbClient`
      INSERT INTO user_devices (user_id, channel, token, environment) VALUES
        (${ownerUserId}, 'ios_push', 'sandbox-only-1', 'sandbox'),
        (${ownerUserId}, 'ios_push', 'sandbox-only-2', 'sandbox')
    `;

    const sandbox = makeStubClient();
    const production = makeStubClient();
    const adapter = createIosPushAdapter({ sandbox: sandbox.client, production: production.client });

    await adapter.deliver({
      db: app.db,
      notificationId: "00000000-0000-0000-0000-0000000000cc",
      deliveryId: "00000000-0000-0000-0000-0000000000dd",
      userId: ownerUserId,
      userEmail: "test@owlmetry.com",
      type: "issue.digest",
      payload: { title: "Sandbox only" },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(sandbox.calls.map((c) => c.token).sort()).toEqual(["sandbox-only-1", "sandbox-only-2"]);
    expect(production.calls).toEqual([]);
  });

  it("skips when the user has no registered devices", async () => {
    const sandbox = makeStubClient();
    const production = makeStubClient();
    const adapter = createIosPushAdapter({ sandbox: sandbox.client, production: production.client });

    const result = await adapter.deliver({
      db: app.db,
      notificationId: "00000000-0000-0000-0000-0000000000ee",
      deliveryId: "00000000-0000-0000-0000-0000000000ff",
      userId: ownerUserId,
      userEmail: "test@owlmetry.com",
      type: "feedback.new",
      payload: { title: "No devices" },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.status).toBe("skipped");
    expect(sandbox.calls).toEqual([]);
    expect(production.calls).toEqual([]);
  });
});
