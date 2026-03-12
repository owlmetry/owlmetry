import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { apps } from "@owlmetry/db";
import type { CreateAppRequest } from "@owlmetry/shared";
import { requireAuth } from "../middleware/auth.js";

export async function appsRoutes(app: FastifyInstance) {
  // List apps
  app.get(
    "/apps",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const team_id = auth.team_id;

      const rows = await app.db
        .select()
        .from(apps)
        .where(eq(apps.team_id, team_id));

      return {
        apps: rows.map((a) => ({
          ...a,
          created_at: a.created_at.toISOString(),
        })),
      };
    }
  );

  // Create app
  app.post<{ Body: CreateAppRequest }>(
    "/apps",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type === "api_key") {
        return reply.code(403).send({ error: "Only users can create apps" });
      }

      const { name, platform, bundle_id } = request.body;

      if (!name || !platform || !bundle_id) {
        return reply
          .code(400)
          .send({ error: "name, platform, and bundle_id are required" });
      }

      const [created] = await app.db
        .insert(apps)
        .values({
          team_id: auth.team_id,
          name,
          platform,
          bundle_id,
        })
        .returning();

      return reply.code(201).send({
        ...created,
        created_at: created.created_at.toISOString(),
      });
    }
  );
}
