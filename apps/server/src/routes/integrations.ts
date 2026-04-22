import type { FastifyInstance } from "fastify";
import { eq, and, isNull, ne } from "drizzle-orm";
import { projectIntegrations, projects } from "@owlmetry/db";
import {
  validateIntegrationConfig,
  redactIntegrationConfig,
  SUPPORTED_PROVIDER_IDS,
  INTEGRATION_PROVIDERS,
  generateWebhookSecret,
} from "@owlmetry/shared";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { logAuditEvent } from "../utils/audit.js";
import { config } from "../config.js";

function serializeIntegration(row: typeof projectIntegrations.$inferSelect) {
  return {
    id: row.id,
    project_id: row.project_id,
    provider: row.provider,
    config: redactIntegrationConfig(row.provider, row.config as Record<string, unknown>),
    enabled: row.enabled,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function buildRevenueCatWebhookSetup(projectId: string, webhookSecret: string) {
  return {
    webhook_url: `${config.publicUrl}/v1/webhooks/revenuecat/${projectId}`,
    authorization_header: `Bearer ${webhookSecret}`,
    environment: "Both Production and Sandbox",
    events_filter: "All apps, All events",
  };
}

/** Routes nested under /v1/projects/:projectId */
export async function integrationsRoutes(app: FastifyInstance) {
  // List supported providers
  app.get(
    "/integrations/providers",
    { preHandler: [requirePermission("integrations:read")] },
    async () => {
      return { providers: INTEGRATION_PROVIDERS };
    }
  );

  // List integrations for a project
  app.get<{ Params: { projectId: string } }>(
    "/integrations",
    { preHandler: [requirePermission("integrations:read")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const rows = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, projectId),
            isNull(projectIntegrations.deleted_at),
          )
        );

      return { integrations: rows.map(serializeIntegration) };
    }
  );

  // Create integration
  app.post<{ Params: { projectId: string }; Body: { provider: string; config: Record<string, unknown> } }>(
    "/integrations",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const { provider, config: integrationConfig } = request.body;

      if (!provider || typeof provider !== "string") {
        return reply.code(400).send({ error: "provider is required" });
      }
      if (!integrationConfig || typeof integrationConfig !== "object") {
        return reply.code(400).send({ error: "config is required" });
      }

      // Validate provider and config against the registry
      const configError = validateIntegrationConfig(provider, integrationConfig);
      if (configError) {
        return reply.code(400).send({ error: configError });
      }

      // Auto-generate webhook secret for RevenueCat (always)
      if (provider === "revenuecat") {
        integrationConfig.webhook_secret = generateWebhookSecret();
      }

      // Check if integration already exists (including soft-deleted)
      const [existing] = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, projectId),
            eq(projectIntegrations.provider, provider),
          )
        )
        .limit(1);

      if (existing && !existing.deleted_at) {
        return reply.code(409).send({ error: `Integration for "${provider}" already exists` });
      }

      let created;
      if (existing && existing.deleted_at) {
        // Restore soft-deleted integration with new config
        [created] = await app.db
          .update(projectIntegrations)
          .set({
            config: integrationConfig,
            enabled: true,
            deleted_at: null,
            updated_at: new Date(),
          })
          .where(eq(projectIntegrations.id, existing.id))
          .returning();
      } else {
        [created] = await app.db
          .insert(projectIntegrations)
          .values({
            project_id: projectId,
            provider,
            config: integrationConfig,
          })
          .returning();
      }

      logAuditEvent(app.db, request.auth, { team_id: project.team_id, action: "create", resource_type: "integration", resource_id: created.id, metadata: { provider } });

      const response: Record<string, unknown> = serializeIntegration(created);

      if (provider === "revenuecat") {
        response.webhook_setup = buildRevenueCatWebhookSetup(projectId, integrationConfig.webhook_secret as string);
      }

      return reply.code(201).send(response);
    }
  );

  // List sibling projects in the same team that have an active integration for :provider.
  // Powers the "Copy from another project" dashboard affordance.
  app.get<{ Params: { projectId: string; provider: string } }>(
    "/integrations/copy-candidates/:provider",
    { preHandler: [requirePermission("integrations:read")] },
    async (request, reply) => {
      const { projectId, provider } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      if (!SUPPORTED_PROVIDER_IDS.includes(provider)) {
        return reply.code(400).send({ error: `Unsupported provider: "${provider}"` });
      }

      const rows = await app.db
        .select({ id: projects.id, name: projects.name, color: projects.color })
        .from(projects)
        .innerJoin(
          projectIntegrations,
          and(
            eq(projectIntegrations.project_id, projects.id),
            eq(projectIntegrations.provider, provider),
            isNull(projectIntegrations.deleted_at),
          ),
        )
        .where(
          and(
            eq(projects.team_id, project.team_id),
            isNull(projects.deleted_at),
            ne(projects.id, projectId),
          ),
        );

      return { candidates: rows };
    }
  );

  // Copy an integration's config from another project in the same team.
  // The target inherits the source's credentials verbatim, EXCEPT RevenueCat's
  // webhook_secret which is regenerated (webhooks are per-project by design).
  app.post<{ Params: { projectId: string; sourceProjectId: string }; Body: { provider: string } }>(
    "/integrations/copy-from/:sourceProjectId",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId, sourceProjectId } = request.params;

      if (projectId === sourceProjectId) {
        return reply.code(400).send({ error: "source and target projects must differ" });
      }

      const { provider } = request.body ?? {};
      if (!provider || typeof provider !== "string") {
        return reply.code(400).send({ error: "provider is required" });
      }
      if (!SUPPORTED_PROVIDER_IDS.includes(provider)) {
        return reply.code(400).send({ error: `Unsupported provider: "${provider}". Supported: ${SUPPORTED_PROVIDER_IDS.join(", ")}` });
      }

      const [target, source] = await Promise.all([
        resolveProject(app, projectId, request.auth, reply),
        resolveProject(app, sourceProjectId, request.auth, reply),
      ]);
      if (!target || !source) return;

      if (source.team_id !== target.team_id) {
        return reply.code(403).send({ error: "source and target projects must belong to the same team" });
      }

      const roleError = assertTeamRole(request.auth, target.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const [sourceIntegration] = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, sourceProjectId),
            eq(projectIntegrations.provider, provider),
            isNull(projectIntegrations.deleted_at),
          )
        )
        .limit(1);

      if (!sourceIntegration) {
        return reply.code(404).send({ error: `Source project has no active "${provider}" integration` });
      }

      const copiedConfig: Record<string, unknown> = { ...(sourceIntegration.config as Record<string, unknown>) };
      if (provider === "revenuecat") {
        copiedConfig.webhook_secret = generateWebhookSecret();
      }

      const [existingOnTarget] = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, projectId),
            eq(projectIntegrations.provider, provider),
          )
        )
        .limit(1);

      if (existingOnTarget && !existingOnTarget.deleted_at) {
        return reply.code(409).send({ error: `Integration for "${provider}" already exists on target project` });
      }

      let created;
      if (existingOnTarget && existingOnTarget.deleted_at) {
        [created] = await app.db
          .update(projectIntegrations)
          .set({
            config: copiedConfig,
            enabled: true,
            deleted_at: null,
            updated_at: new Date(),
          })
          .where(eq(projectIntegrations.id, existingOnTarget.id))
          .returning();
      } else {
        [created] = await app.db
          .insert(projectIntegrations)
          .values({
            project_id: projectId,
            provider,
            config: copiedConfig,
            enabled: true,
          })
          .returning();
      }

      logAuditEvent(app.db, request.auth, { team_id: target.team_id, action: "create", resource_type: "integration", resource_id: created.id, metadata: { provider, copied_from: sourceProjectId } });

      const response: Record<string, unknown> = serializeIntegration(created);

      if (provider === "revenuecat") {
        response.webhook_setup = buildRevenueCatWebhookSetup(projectId, copiedConfig.webhook_secret as string);
      }

      return reply.code(201).send(response);
    }
  );

  // Update integration
  app.patch<{ Params: { projectId: string; provider: string }; Body: { config?: Record<string, unknown>; enabled?: boolean } }>(
    "/integrations/:provider",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId, provider } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      if (!SUPPORTED_PROVIDER_IDS.includes(provider)) {
        return reply.code(400).send({ error: `Unsupported provider: "${provider}". Supported: ${SUPPORTED_PROVIDER_IDS.join(", ")}` });
      }

      const [existing] = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, projectId),
            eq(projectIntegrations.provider, provider),
            isNull(projectIntegrations.deleted_at),
          )
        )
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: "Integration not found" });
      }

      const updates: Record<string, unknown> = { updated_at: new Date() };

      if (request.body.config !== undefined) {
        // On update, merge new config with existing config so partial updates work
        // Then validate the merged result (excluding internal fields like webhook_secret)
        const existingConfig = (existing.config as Record<string, unknown>) ?? {};
        const mergedConfig = { ...existingConfig, ...request.body.config };
        const { webhook_secret, ...configToValidate } = mergedConfig;
        const configError = validateIntegrationConfig(provider, configToValidate as Record<string, unknown>);
        if (configError) {
          return reply.code(400).send({ error: configError });
        }
        updates.config = mergedConfig;
      }

      if (request.body.enabled !== undefined) {
        updates.enabled = request.body.enabled;
      }

      const [updated] = await app.db
        .update(projectIntegrations)
        .set(updates)
        .where(eq(projectIntegrations.id, existing.id))
        .returning();

      logAuditEvent(app.db, request.auth, { team_id: project.team_id, action: "update", resource_type: "integration", resource_id: updated.id, metadata: { provider } });

      return serializeIntegration(updated);
    }
  );

  // Delete integration (soft delete)
  app.delete<{ Params: { projectId: string; provider: string } }>(
    "/integrations/:provider",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId, provider } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const [existing] = await app.db
        .select()
        .from(projectIntegrations)
        .where(
          and(
            eq(projectIntegrations.project_id, projectId),
            eq(projectIntegrations.provider, provider),
            isNull(projectIntegrations.deleted_at),
          )
        )
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: "Integration not found" });
      }

      await app.db
        .update(projectIntegrations)
        .set({ deleted_at: new Date() })
        .where(eq(projectIntegrations.id, existing.id));

      logAuditEvent(app.db, request.auth, { team_id: project.team_id, action: "delete", resource_type: "integration", resource_id: existing.id, metadata: { provider } });

      return { deleted: true };
    }
  );
}
