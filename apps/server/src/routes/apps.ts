import type { FastifyInstance } from "fastify";
import { eq, and, inArray } from "drizzle-orm";
import { apps, projects } from "@owlmetry/db";
import type { CreateAppRequest } from "@owlmetry/shared";
import { requireAuth, getAuthTeamIds, hasTeamAccess } from "../middleware/auth.js";

export async function appsRoutes(app: FastifyInstance) {
  // List apps for the authenticated user's teams
  app.get(
    "/apps",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const teamIds = getAuthTeamIds(auth);

      const rows = await app.db
        .select()
        .from(apps)
        .where(inArray(apps.team_id, teamIds));

      return {
        apps: rows.map((a) => ({
          ...a,
          created_at: a.created_at.toISOString(),
        })),
      };
    }
  );

  // Create app (team derived from project)
  app.post<{ Body: CreateAppRequest }>(
    "/apps",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can create apps" });
      }

      const { name, platform, bundle_id, project_id } = request.body;

      if (!name || !platform || !bundle_id || !project_id) {
        return reply
          .code(400)
          .send({
            error: "name, platform, bundle_id, and project_id are required",
          });
      }

      // Look up project and verify team membership
      const [project] = await app.db
        .select({ id: projects.id, team_id: projects.team_id })
        .from(projects)
        .where(eq(projects.id, project_id))
        .limit(1);

      if (!project || !hasTeamAccess(auth, project.team_id)) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const [created] = await app.db
        .insert(apps)
        .values({
          team_id: project.team_id,
          project_id,
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
