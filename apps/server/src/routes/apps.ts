import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { apps, projects, apiKeys } from "@owlmetry/db";
import type { CreateAppRequest, UpdateAppRequest } from "@owlmetry/shared";
import { DEFAULT_API_KEY_PERMISSIONS, generateApiKey } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds, hasTeamAccess, assertTeamRole } from "../middleware/auth.js";
import { serializeApiKey, serializeApp } from "../utils/serialize.js";

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

  // Create app (team derived from project)
  app.post<{ Body: CreateAppRequest }>(
    "/apps",
    { preHandler: requirePermission("apps:write") },
    async (request, reply) => {
      const auth = request.auth;
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

      if (!project || !hasTeamAccess(auth, project.team_id)) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const createRoleError = assertTeamRole(auth, project.team_id, "admin");
      if (createRoleError) {
        return reply.code(403).send({ error: createRoleError });
      }

      const { fullKey, keyHash, keyPrefix } = generateApiKey("client");

      const { created, clientKey } = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(apps)
          .values({
            team_id: project.team_id,
            project_id,
            name,
            platform,
            bundle_id,
          })
          .returning();

        const [clientKey] = await tx
          .insert(apiKeys)
          .values({
            key_hash: keyHash,
            key_prefix: keyPrefix,
            key_type: "client",
            app_id: created.id,
            team_id: project.team_id,
            name: `${name} Client Key`,
            permissions: DEFAULT_API_KEY_PERMISSIONS.client,
          })
          .returning();

        return { created, clientKey };
      });

      return reply.code(201).send({
        ...serializeApp(created),
        client_key: {
          key: fullKey,
          api_key: serializeApiKey(clientKey),
        },
      });
    }
  );

  // Update app
  app.patch<{ Params: { id: string }; Body: UpdateAppRequest }>(
    "/apps/:id",
    { preHandler: requirePermission("apps:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;
      const { name, bundle_id } = request.body;

      if (!name && !bundle_id) {
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

      const updates: Partial<{ name: string; bundle_id: string }> = {};
      if (name) updates.name = name;
      if (bundle_id) updates.bundle_id = bundle_id;

      const [updated] = await app.db
        .update(apps)
        .set(updates)
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
