import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { userDevices } from "@owlmetry/db";
import {
  NOTIFICATION_CHANNELS,
  type RegisterDeviceRequest,
} from "@owlmetry/shared";
import { requireAuth } from "../middleware/auth.js";

const PUSH_CHANNELS: ReadonlyArray<string> = ["ios_push"];

function serializeDevice(row: typeof userDevices.$inferSelect) {
  return {
    id: row.id,
    channel: row.channel,
    environment: row.environment,
    app_version: row.app_version,
    device_model: row.device_model,
    os_version: row.os_version,
    last_seen_at: row.last_seen_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

export async function devicesRoutes(app: FastifyInstance) {
  // Register / upsert a device token. Token is the unique key — if the same
  // token is later re-registered by a different user (device wipe + re-login),
  // the row's user_id is reassigned atomically.
  app.post<{ Body: RegisterDeviceRequest }>(
    "/devices",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Devices are user-scoped" });
      }
      const body = request.body ?? ({} as RegisterDeviceRequest);
      if (!PUSH_CHANNELS.includes(body.channel) || !(NOTIFICATION_CHANNELS as readonly string[]).includes(body.channel)) {
        return reply.code(400).send({ error: `Invalid channel '${body.channel}'` });
      }
      if (!body.token || typeof body.token !== "string") {
        return reply.code(400).send({ error: "token is required" });
      }
      const env = body.environment === "sandbox" ? "sandbox" : "production";
      const now = new Date();

      const [row] = await app.db
        .insert(userDevices)
        .values({
          user_id: request.auth.user_id,
          channel: body.channel,
          token: body.token,
          environment: env,
          app_version: body.app_version ?? null,
          device_model: body.device_model ?? null,
          os_version: body.os_version ?? null,
          last_seen_at: now,
        })
        .onConflictDoUpdate({
          target: userDevices.token,
          set: {
            user_id: request.auth.user_id,
            channel: body.channel,
            environment: env,
            app_version: body.app_version ?? null,
            device_model: body.device_model ?? null,
            os_version: body.os_version ?? null,
            last_seen_at: now,
          },
        })
        .returning();

      return reply.code(201).send({ device: serializeDevice(row) });
    },
  );

  // List user's devices
  app.get(
    "/devices",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Devices are user-scoped" });
      }
      const rows = await app.db
        .select()
        .from(userDevices)
        .where(eq(userDevices.user_id, request.auth.user_id))
        .orderBy(desc(userDevices.last_seen_at));
      return { devices: rows.map(serializeDevice) };
    },
  );

  // Revoke (hard delete — registry, not data)
  app.delete<{ Params: { id: string } }>(
    "/devices/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.auth.type !== "user") {
        return reply.code(403).send({ error: "Devices are user-scoped" });
      }
      const [deleted] = await app.db
        .delete(userDevices)
        .where(
          and(eq(userDevices.id, request.params.id), eq(userDevices.user_id, request.auth.user_id)),
        )
        .returning({ id: userDevices.id });
      if (!deleted) return reply.code(404).send({ error: "Device not found" });
      return { id: deleted.id };
    },
  );
}
