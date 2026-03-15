import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { apps, projects, apiKeys } from "@owlmetry/db";
import type { CreateAppRequest, UpdateAppRequest } from "@owlmetry/shared";
import { APP_PLATFORMS, DEFAULT_API_KEY_PERMISSIONS, generateApiKey } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds, hasTeamAccess, assertTeamRole } from "../middleware/auth.js";
import { serializeApp } from "../utils/serialize.js";

export async function appsRoutes(app: FastifyInstance) {
  // List apps for the authenticated user's teams
  app.get(
    "/apps",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const teamIds = getAuthTeamIds(auth);

      const rows = await app.db
        .select()
        .from(apps)
        .where(and(inArray(apps.team_id, teamIds), isNull(apps.deleted_at)));

      return {
        apps: rows.map(serializeApp),
      };
    }
  );

  // Get single app
  app.get<{ Params: { id: string } }>(
    "/apps/:id",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
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

      return serializeApp(existing);
    }
  );

  // Create app (team derived from project)
  app.post<{ Body: CreateAppRequest }>(
    "/apps",
    { preHandler: requirePermission("apps:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { name, platform, bundle_id, project_id } = request.body;

      if (!name || !platform || !project_id) {
        return reply
          .code(400)
          .send({
            error: "name, platform, and project_id are required",
          });
      }

      if (!(APP_PLATFORMS as readonly string[]).includes(platform)) {
        return reply
          .code(400)
          .send({ error: `Invalid platform. Must be one of: ${APP_PLATFORMS.join(", ")}` });
      }

      // Backend apps don't need a bundle_id; all other platforms require it
      if (platform !== "backend" && !bundle_id) {
        return reply
          .code(400)
          .send({ error: "bundle_id is required for non-backend platforms" });
      }

      // Look up project and verify team membership
      const [project] = await app.db
        .select({ id: projects.id, team_id: projects.team_id })
        .from(projects)
        .where(and(eq(projects.id, project_id), isNull(projects.deleted_at)))
        .limit(1);

      if (!project || !hasTeamAccess(auth, project.team_id)) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const createRoleError = assertTeamRole(auth, project.team_id, "admin");
      if (createRoleError) {
        return reply.code(403).send({ error: createRoleError });
      }

      const { fullKey, keyHash, keyPrefix } = generateApiKey("client");

      const created = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(apps)
          .values({
            team_id: project.team_id,
            project_id,
            name,
            platform,
            bundle_id: bundle_id || null,
            client_key: fullKey,
          })
          .returning();

        await tx
          .insert(apiKeys)
          .values({
            key_hash: keyHash,
            key_prefix: keyPrefix,
            key_type: "client",
            app_id: created.id,
            team_id: project.team_id,
            name: `${name} Client Key`,
            permissions: DEFAULT_API_KEY_PERMISSIONS.client,
          });

        return created;
      });

      return reply.code(201).send(serializeApp(created));
    }
  );

  // Update app
  app.patch<{ Params: { id: string }; Body: UpdateAppRequest }>(
    "/apps/:id",
    { preHandler: requirePermission("apps:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;
      const { name } = request.body;

      if (!name) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const [existing] = await app.db
        .select({ id: apps.id, team_id: apps.team_id })
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

      const [updated] = await app.db
        .update(apps)
        .set({ name })
        .where(eq(apps.id, id))
        .returning();

      return serializeApp(updated);
    }
  );

  // Delete app (soft delete)
  app.delete<{ Params: { id: string } }>(
    "/apps/:id",
    { preHandler: requirePermission("apps:write") },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete apps" });
      }

      const { id } = request.params;

      const [existing] = await app.db
        .select({ id: apps.id, team_id: apps.team_id })
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
