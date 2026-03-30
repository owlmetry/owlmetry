import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { apps, projects, apiKeys } from "@owlmetry/db";
import type { CreateAppRequest, UpdateAppRequest } from "@owlmetry/shared";
import { APP_PLATFORMS, DEFAULT_API_KEY_PERMISSIONS, generateApiKeySecret } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds, hasTeamAccess, assertTeamRole } from "../middleware/auth.js";
import { serializeApp, getClientSecret, getClientSecretMap } from "../utils/serialize.js";
import { logAuditEvent } from "../utils/audit.js";

export async function appsRoutes(app: FastifyInstance) {
  // List apps for the authenticated user's teams
  app.get<{ Querystring: { team_id?: string } }>(
    "/apps",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      const { team_id } = request.query;

      // If team_id is specified, validate access and scope to that team
      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { apps: [] };
      }

      const rows = await app.db
        .select()
        .from(apps)
        .where(and(inArray(apps.team_id, teamIds), isNull(apps.deleted_at)));

      const secretMap = await getClientSecretMap(app.db, rows.map(r => r.id));

      return {
        apps: rows.map(r => serializeApp({ ...r, client_secret: secretMap.get(r.id) ?? null })),
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

      return serializeApp({ ...existing, client_secret: await getClientSecret(app.db, id) });
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

      const clientSecret = generateApiKeySecret("client");

      const created = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(apps)
          .values({
            team_id: project.team_id,
            project_id,
            name,
            platform,
            bundle_id: bundle_id || null,
          })
          .returning();

        await tx
          .insert(apiKeys)
          .values({
            secret: clientSecret,
            key_type: "client",
            app_id: created.id,
            team_id: project.team_id,
            name: `${name} Client Key`,
            created_by: auth.type === "user" ? auth.user_id : auth.created_by,
            permissions: DEFAULT_API_KEY_PERMISSIONS.client,
          });

        return { ...created, client_secret: clientSecret };
      });

      logAuditEvent(app.db, auth, {
        team_id: project.team_id,
        action: "create",
        resource_type: "app",
        resource_id: created.id,
        metadata: { name, platform, bundle_id: bundle_id || null },
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
        .select({ id: apps.id, team_id: apps.team_id, name: apps.name })
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

      logAuditEvent(app.db, auth, {
        team_id: existing.team_id,
        action: "update",
        resource_type: "app",
        resource_id: id,
        changes: { name: { before: existing.name, after: name } },
      });

      return serializeApp({ ...updated, client_secret: await getClientSecret(app.db, id) });
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

      const now = new Date();

      // Soft-delete the app and its api_keys
      await Promise.all([
        app.db
          .update(apps)
          .set({ deleted_at: now })
          .where(eq(apps.id, id)),
        app.db
          .update(apiKeys)
          .set({ deleted_at: now })
          .where(and(eq(apiKeys.app_id, id), isNull(apiKeys.deleted_at))),
      ]);

      logAuditEvent(app.db, auth, {
        team_id: existing.team_id,
        action: "delete",
        resource_type: "app",
        resource_id: id,
      });

      return { deleted: true };
    }
  );
}
