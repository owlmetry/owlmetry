import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { apps, projects } from "@owlmetry/db";
import type { CreateAppRequest, UpdateAppRequest } from "@owlmetry/shared";
import { requireAuth, getAuthTeamIds, hasTeamAccess, assertTeamRole } from "../middleware/auth.js";

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
        .where(and(inArray(apps.team_id, teamIds), isNull(apps.deleted_at)));

      return {
        apps: rows.map((a) => ({
          ...a,
          created_at: a.created_at.toISOString(),
          deleted_at: undefined,
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
        .where(and(eq(projects.id, project_id), isNull(projects.deleted_at)))
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const createRoleError = assertTeamRole(auth, project.team_id, "admin");
      if (createRoleError) {
        return reply.code(403).send({ error: createRoleError });
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
        deleted_at: undefined,
      });
    }
  );

  // Update app
  app.patch<{ Params: { id: string }; Body: UpdateAppRequest }>(
    "/apps/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can update apps" });
      }

      const { id } = request.params;
      const { name, bundle_id } = request.body;

      if (!name && !bundle_id) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const [existing] = await app.db
        .select()
        .from(apps)
        .where(
          and(
            eq(apps.id, id),
            inArray(apps.team_id, getAuthTeamIds(auth)),
            isNull(apps.deleted_at)
          )
        )
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: "App not found" });
      }

      const updateRoleError = assertTeamRole(auth, existing.team_id, "admin");
      if (updateRoleError) {
        return reply.code(403).send({ error: updateRoleError });
      }

      const updates: Partial<{ name: string; bundle_id: string }> = {};
      if (name) updates.name = name;
      if (bundle_id) updates.bundle_id = bundle_id;

      const [updated] = await app.db
        .update(apps)
        .set(updates)
        .where(eq(apps.id, id))
        .returning();

      return {
        ...updated,
        created_at: updated.created_at.toISOString(),
        deleted_at: undefined,
      };
    }
  );

  // Delete app (soft delete)
  app.delete<{ Params: { id: string } }>(
    "/apps/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete apps" });
      }

      const { id } = request.params;

      const [existing] = await app.db
        .select()
        .from(apps)
        .where(
          and(
            eq(apps.id, id),
            inArray(apps.team_id, getAuthTeamIds(auth)),
            isNull(apps.deleted_at)
          )
        )
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: "App not found" });
      }

      const deleteRoleError = assertTeamRole(auth, existing.team_id, "admin");
      if (deleteRoleError) {
        return reply.code(403).send({ error: deleteRoleError });
      }

      await app.db
        .update(apps)
        .set({ deleted_at: new Date() })
        .where(eq(apps.id, id));

      return { deleted: true };
    }
  );
}
