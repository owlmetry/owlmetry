import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { projects, apps } from "@owlmetry/db";
import type { CreateProjectRequest, UpdateProjectRequest } from "@owlmetry/shared";
import { SLUG_REGEX, PG_UNIQUE_VIOLATION } from "@owlmetry/shared";
import { serializeApp } from "../utils/serialize.js";
import { requirePermission, getAuthTeamIds, hasTeamAccess, assertTeamRole } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";

export async function projectsRoutes(app: FastifyInstance) {
  // List projects for the authenticated user's teams
  app.get(
    "/projects",
    { preHandler: requirePermission("projects:read") },
    async (request, reply) => {
      const auth = request.auth;
      const teamIds = getAuthTeamIds(auth);

      const rows = await app.db
        .select()
        .from(projects)
        .where(and(inArray(projects.team_id, teamIds), isNull(projects.deleted_at)));

      return {
        projects: rows.map((p) => ({
          ...p,
          created_at: p.created_at.toISOString(),
          deleted_at: undefined,
        })),
      };
    }
  );

  // Get single project with its apps
  app.get<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;

      const [project] = await app.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth)),
            isNull(projects.deleted_at)
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const projectApps = await app.db
        .select()
        .from(apps)
        .where(and(eq(apps.project_id, id), isNull(apps.deleted_at)));

      return {
        ...project,
        created_at: project.created_at.toISOString(),
        deleted_at: undefined,
        apps: projectApps.map(serializeApp),
      };
    }
  );

  // Create project
  app.post<{ Body: CreateProjectRequest }>(
    "/projects",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { team_id, name, slug } = request.body;

      if (!team_id || !name || !slug) {
        return reply
          .code(400)
          .send({ error: "team_id, name, and slug are required" });
      }

      if (!SLUG_REGEX.test(slug)) {
        return reply
          .code(400)
          .send({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
      }

      if (!hasTeamAccess(auth, team_id)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      const roleError = assertTeamRole(auth, team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
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

        logAuditEvent(app.db, auth, {
          team_id,
          action: "create",
          resource_type: "project",
          resource_id: created.id,
          metadata: { name, slug },
        });

        return reply.code(201).send({
          ...created,
          created_at: created.created_at.toISOString(),
          deleted_at: undefined,
        });
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          return reply
            .code(409)
            .send({ error: "A project with this slug already exists in your team" });
        }
        throw err;
      }
    }
  );

  // Update project
  app.patch<{ Params: { id: string }; Body: UpdateProjectRequest }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;
      const { name } = request.body;

      if (!name) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const [project] = await app.db
        .select({ id: projects.id, team_id: projects.team_id, name: projects.name })
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth)),
            isNull(projects.deleted_at)
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const updateRoleError = assertTeamRole(auth, project.team_id, "admin");
      if (updateRoleError) {
        return reply.code(403).send({ error: updateRoleError });
      }

      const [updated] = await app.db
        .update(projects)
        .set({ name })
        .where(eq(projects.id, id))
        .returning();

      logAuditEvent(app.db, auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "project",
        resource_id: id,
        changes: { name: { before: project.name, after: name } },
      });

      return {
        ...updated,
        created_at: updated.created_at.toISOString(),
        deleted_at: undefined,
      };
    }
  );

  // Delete project (soft delete)
  app.delete<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete projects" });
      }

      const { id } = request.params;

      const [project] = await app.db
        .select({ id: projects.id, team_id: projects.team_id })
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth)),
            isNull(projects.deleted_at)
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const deleteRoleError = assertTeamRole(auth, project.team_id, "admin");
      if (deleteRoleError) {
        return reply.code(403).send({ error: deleteRoleError });
      }

      const now = new Date();

      // Soft-delete the project and all its apps
      await Promise.all([
        app.db
          .update(apps)
          .set({ deleted_at: now })
          .where(and(eq(apps.project_id, id), isNull(apps.deleted_at))),
        app.db
          .update(projects)
          .set({ deleted_at: now })
          .where(eq(projects.id, id)),
      ]);

      logAuditEvent(app.db, auth, {
        team_id: project.team_id,
        action: "delete",
        resource_type: "project",
        resource_id: id,
      });

      return { deleted: true };
    }
  );
}
