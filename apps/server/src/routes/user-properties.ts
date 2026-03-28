import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import {
  MAX_USER_PROPERTY_KEY_LENGTH,
  MAX_USER_PROPERTY_VALUE_LENGTH,
  MAX_USER_PROPERTIES_COUNT,
  ANONYMOUS_ID_PREFIX,
} from "@owlmetry/shared";
import type { SetUserPropertiesRequest, SetUserPropertiesResponse } from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";

export async function userPropertiesRoutes(app: FastifyInstance) {
  app.post<{ Body: SetUserPropertiesRequest }>(
    "/identity/properties",
    { preHandler: [requirePermission("users:write")] },
    async (request, reply) => {
      const auth = request.auth;
      const { user_id, properties } = request.body;

      if (!user_id || typeof user_id !== "string") {
        return reply.code(400).send({ error: "user_id is required" });
      }

      if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        return reply.code(400).send({ error: "properties must be an object" });
      }

      // Validate keys and values
      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (typeof key !== "string" || key.length === 0) {
          return reply.code(400).send({ error: "Property keys must be non-empty strings" });
        }
        if (key.length > MAX_USER_PROPERTY_KEY_LENGTH) {
          return reply.code(400).send({ error: `Property key "${key}" exceeds max length of ${MAX_USER_PROPERTY_KEY_LENGTH}` });
        }
        if (typeof value !== "string") {
          return reply.code(400).send({ error: `Property value for "${key}" must be a string` });
        }
        if (value.length > MAX_USER_PROPERTY_VALUE_LENGTH) {
          return reply.code(400).send({ error: `Property value for "${key}" exceeds max length of ${MAX_USER_PROPERTY_VALUE_LENGTH}` });
        }
        // Empty string = delete key (handled after merge)
        if (value !== "") {
          cleaned[key] = value;
        }
      }

      const app_id = auth.type === "api_key" ? auth.app_id : null;
      if (!app_id) {
        return reply.code(400).send({ error: "Client key must be scoped to an app" });
      }

      // Fetch existing user to merge properties
      const [existing] = await app.db
        .select()
        .from(appUsers)
        .where(and(eq(appUsers.app_id, app_id), eq(appUsers.user_id, user_id)))
        .limit(1);

      // Build merged properties
      const existingProps: Record<string, string> = (existing?.properties as Record<string, string>) ?? {};
      const merged = { ...existingProps, ...cleaned };

      // Remove keys explicitly deleted (value was empty string in request)
      for (const [key, value] of Object.entries(properties)) {
        if (value === "") {
          delete merged[key];
        }
      }

      if (Object.keys(merged).length > MAX_USER_PROPERTIES_COUNT) {
        return reply.code(400).send({
          error: `Total properties count exceeds max of ${MAX_USER_PROPERTIES_COUNT}`,
        });
      }

      if (existing) {
        await app.db
          .update(appUsers)
          .set({ properties: merged })
          .where(eq(appUsers.id, existing.id));
      } else {
        // Upsert: create user row if it doesn't exist yet
        await app.db
          .insert(appUsers)
          .values({
            app_id,
            user_id,
            is_anonymous: user_id.startsWith(ANONYMOUS_ID_PREFIX),
            properties: merged,
          })
          .onConflictDoUpdate({
            target: [appUsers.app_id, appUsers.user_id],
            set: { properties: sql`COALESCE(app_users.properties, '{}'::jsonb) || ${JSON.stringify(merged)}::jsonb` },
          });
      }

      return {
        updated: true,
        properties: merged,
      } satisfies SetUserPropertiesResponse;
    }
  );
}
