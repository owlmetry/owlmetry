import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { userDevices } from "@owlmetry/db";
import type { RegisterDeviceRequest } from "@owlmetry/shared";
import { PUSH_CHANNELS, DEVICE_PLATFORMS } from "@owlmetry/shared";
import { requireUser, userAuth } from "../middleware/auth.js";

function serializeDevice(row: typeof userDevices.$inferSelect) {
  return {
    id: row.id,
    channel: row.channel,
    platform: row.platform,
    environment: row.environment,
    app_version: row.app_version,
    device_model: row.device_model,
    os_version: row.os_version,
    last_seen_at: row.last_seen_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

export async function devicesRoutes(app: FastifyInstance) {
  // Token is the unique key — re-registering the same token under a different
  // user atomically reassigns ownership (Apple may reissue tokens after device
  // wipe + re-login).
  app.post<{ Body: RegisterDeviceRequest }>(
    "/devices",
    { preHandler: requireUser },
    async (request, reply) => {
      const body = request.body ?? ({} as RegisterDeviceRequest);
      if (!(PUSH_CHANNELS as readonly string[]).includes(body.channel)) {
        return reply.code(400).send({ error: `Invalid channel '${body.channel}'` });
      }
      if (!(DEVICE_PLATFORMS as readonly string[]).includes(body.platform)) {
        return reply.code(400).send({ error: `Invalid platform '${body.platform}'` });
      }
      if (!body.token || typeof body.token !== "string") {
        return reply.code(400).send({ error: "token is required" });
      }
      const env = body.environment === "sandbox" ? "sandbox" : "production";
      const now = new Date();

      const [row] = await app.db
        .insert(userDevices)
        .values({
          user_id: userAuth(request).user_id,
          channel: body.channel,
          platform: body.platform,
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
            user_id: userAuth(request).user_id,
            channel: body.channel,
            platform: body.platform,
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

  app.get(
    "/devices",
    { preHandler: requireUser },
    async (request) => {
      const rows = await app.db
        .select()
        .from(userDevices)
        .where(eq(userDevices.user_id, userAuth(request).user_id))
        .orderBy(desc(userDevices.last_seen_at));
      return { devices: rows.map(serializeDevice) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/devices/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const [deleted] = await app.db
        .delete(userDevices)
        .where(
          and(eq(userDevices.id, request.params.id), eq(userDevices.user_id, userAuth(request).user_id)),
        )
        .returning({ id: userDevices.id });
      if (!deleted) return reply.code(404).send({ error: "Device not found" });
      return { id: deleted.id };
    },
  );
}
