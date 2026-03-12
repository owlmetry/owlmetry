import type { FastifyInstance } from "fastify";
import { eq, and, inArray } from "drizzle-orm";
import { projects, apps } from "@owlmetry/db";
import type { CreateProjectRequest } from "@owlmetry/shared";
import { requireAuth, getAuthTeamIds, hasTeamAccess } from "../middleware/auth.js";

export async function projectsRoutes(app: FastifyInstance) {
  // List projects for the authenticated user's teams
  app.get(
    "/projects",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const teamIds = getAuthTeamIds(auth);

      const rows = await app.db
        .select()
        .from(projects)
        .where(inArray(projects.team_id, teamIds));

      return {
        projects: rows.map((p) => ({
          ...p,
          created_at: p.created_at.toISOString(),
        })),
      };
    }
  );

  // Get single project with its apps
  app.get<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;

      const [project] = await app.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth))
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const projectApps = await app.db
        .select()
        .from(apps)
        .where(eq(apps.project_id, id));

      return {
        ...project,
        created_at: project.created_at.toISOString(),
        apps: projectApps.map((a) => ({
          ...a,
          created_at: a.created_at.toISOString(),
        })),
      };
    }
  );

  // Create project
  app.post<{ Body: CreateProjectRequest }>(
    "/projects",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply
          .code(403)
          .send({ error: "Only users can create projects" });
      }

      const { team_id, name, slug } = request.body;

      if (!team_id || !name || !slug) {
        return reply
          .code(400)
          .send({ error: "team_id, name, and slug are required" });
      }

      if (!/^[a-z0-9-]+$/.test(slug)) {
        return reply
          .code(400)
          .send({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
      }

      if (!hasTeamAccess(auth, team_id)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      try {
        const [created] = await app.db
          .insert(projects)
          .values({
            team_id,
            name,
            slug,
          })
          .returning();

        return reply.code(201).send({
          ...created,
          created_at: created.created_at.toISOString(),
        });
      } catch (err: any) {
        if (err.code === "23505") {
          return reply
            .code(409)
            .send({ error: "A project with this slug already exists in your team" });
        }
        throw err;
      }
    }
  );
}
