import type { FastifyInstance } from "fastify";
import { eq, and, isNull, ne } from "drizzle-orm";
import { projectIntegrations, projects } from "@owlmetry/db";
import {
  validateIntegrationConfig,
  redactIntegrationConfig,
  stripServerManagedKeys,
  hasAllAppleAdsUserConfigKeys,
  hasAllAppStoreConnectConfigKeys,
  SUPPORTED_PROVIDER_IDS,
  INTEGRATION_PROVIDERS,
  INTEGRATION_PROVIDER_IDS,
  generateWebhookSecret,
} from "@owlmetry/shared";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { logAuditEvent } from "../utils/audit.js";
import { config } from "../config.js";
import { generateAppleAdsKeypair } from "../utils/apple-ads/keypair.js";
import { getAppleAdsAcls } from "../utils/apple-ads/client.js";
import type { AppleAdsAuthConfig } from "../utils/apple-ads/config.js";
import { listAppStoreConnectApps } from "../utils/app-store-connect/client.js";
import type { AppStoreConnectConfig } from "../utils/app-store-connect/config.js";

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

      const { provider, config: rawConfig } = request.body;

      if (!provider || typeof provider !== "string") {
        return reply.code(400).send({ error: "provider is required" });
      }
      if (!rawConfig || typeof rawConfig !== "object") {
        return reply.code(400).send({ error: "config is required" });
      }

      // Strip server-managed keys before validation. Callers can't inject
      // values like a private key or webhook secret — the server generates
      // those itself.
      const integrationConfig = stripServerManagedKeys(provider, rawConfig as Record<string, unknown>);

      const configError = validateIntegrationConfig(provider, integrationConfig);
      if (configError) {
        return reply.code(400).send({ error: configError });
      }

      // Provider-specific server-side initialization.
      let enabled = true;
      if (provider === INTEGRATION_PROVIDER_IDS.REVENUECAT) {
        integrationConfig.webhook_secret = generateWebhookSecret();
      } else if (provider === INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS) {
        const keypair = generateAppleAdsKeypair();
        integrationConfig.private_key_pem = keypair.private_key_pem;
        integrationConfig.public_key_pem = keypair.public_key_pem;
        // Apple Search Ads setup is multi-step. The integration stays
        // disabled until the user uploads the public key to Apple and fills
        // in client_id, team_id, key_id, and org_id.
        enabled = hasAllAppleAdsUserConfigKeys(integrationConfig);
      } else if (provider === INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT) {
        // Single-step setup — user pastes issuer_id, key_id, and the .p8
        // contents up front. Validation already enforced presence above.
        enabled = hasAllAppStoreConnectConfigKeys(integrationConfig);
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
            enabled,
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
            enabled,
          })
          .returning();
      }

      logAuditEvent(app.db, request.auth, { team_id: project.team_id, action: "create", resource_type: "integration", resource_id: created.id, metadata: { provider } });

      const response: Record<string, unknown> = serializeIntegration(created);

      if (provider === INTEGRATION_PROVIDER_IDS.REVENUECAT) {
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
      const copyEnabled = true;
      if (provider === INTEGRATION_PROVIDER_IDS.REVENUECAT) {
        // Webhook URLs are per-project, so each project gets its own secret.
        copiedConfig.webhook_secret = generateWebhookSecret();
      }
      // Apple Search Ads: copy the full config verbatim (including the
      // keypair and all four IDs). Apple only allows one active cert per
      // API user, so regenerating per project would force the user to
      // set up 1 API user per Owlmetry project. Within a team, sharing
      // the private key is safe — team admins already have access to all
      // projects. Same trust model as RevenueCat's api_key, which is also
      // copied verbatim.

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
            enabled: copyEnabled,
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
            enabled: copyEnabled,
          })
          .returning();
      }

      logAuditEvent(app.db, request.auth, { team_id: target.team_id, action: "create", resource_type: "integration", resource_id: created.id, metadata: { provider, copied_from: sourceProjectId } });

      const response: Record<string, unknown> = serializeIntegration(created);

      if (provider === INTEGRATION_PROVIDER_IDS.REVENUECAT) {
        response.webhook_setup = buildRevenueCatWebhookSetup(projectId, copiedConfig.webhook_secret as string);
      }

      if (provider === INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS) {
        // One-step copy: run a live `/acls` call against Apple with the
        // duplicated credentials so the caller can confirm the clone
        // actually works end-to-end. No separate "Test Connection"
        // round-trip needed. Failures don't roll back the copy — the row
        // is already written and the user can debug via the dashboard.
        const aclsResult = await getAppleAdsAcls(copiedConfig as unknown as AppleAdsAuthConfig);
        if (aclsResult.status === "found") {
          response.connection_test = {
            ok: true,
            orgs: aclsResult.data.map((o) => ({ org_id: o.orgId, org_name: o.orgName })),
          };
        } else if (aclsResult.status === "auth_error") {
          response.connection_test = { ok: false, error: "auth_error", message: aclsResult.message };
        } else if (aclsResult.status === "not_found") {
          response.connection_test = { ok: false, error: "no_orgs", message: "Apple Ads returned no accessible orgs." };
        } else {
          response.connection_test = { ok: false, error: "upstream_error", message: aclsResult.message };
        }
      }

      if (provider === INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT) {
        // Same pattern as ASA: live test the copied .p8 against ASC's apps
        // endpoint so the caller can confirm the credentials still authorize
        // against Apple before triggering a sync on the new project.
        const appsResult = await listAppStoreConnectApps(copiedConfig as unknown as AppStoreConnectConfig);
        if (appsResult.status === "found") {
          response.connection_test = {
            ok: true,
            apps: appsResult.data.map((a) => ({ id: a.id, name: a.name, bundle_id: a.bundleId })),
          };
        } else if (appsResult.status === "auth_error") {
          response.connection_test = { ok: false, error: "auth_error", message: appsResult.message };
        } else if (appsResult.status === "not_found") {
          response.connection_test = { ok: false, error: "no_apps", message: "App Store Connect returned no accessible apps." };
        } else {
          response.connection_test = { ok: false, error: "upstream_error", message: appsResult.message };
        }
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
        // Strip server-managed keys (private_key_pem, webhook_secret, etc.)
        // from the inbound patch — those are generated server-side and never
        // accepted from the client. Then merge into existing config so
        // blank fields preserve the prior value.
        const existingConfig = (existing.config as Record<string, unknown>) ?? {};
        const inboundConfig = stripServerManagedKeys(provider, request.body.config);
        const mergedConfig = { ...existingConfig, ...inboundConfig };
        const configError = validateIntegrationConfig(provider, mergedConfig);
        if (configError) {
          return reply.code(400).send({ error: configError });
        }
        updates.config = mergedConfig;

        // Apple Search Ads: auto-toggle enabled based on whether the user
        // has finished filling in the four ID fields. The user never sets
        // enabled manually for this provider — it's derived.
        if (provider === INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS) {
          updates.enabled = hasAllAppleAdsUserConfigKeys(mergedConfig);
        } else if (provider === INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT) {
          // ASC: enabled iff issuer_id, key_id, and private_key_p8 are all
          // present. Same derivation pattern as ASA.
          updates.enabled = hasAllAppStoreConnectConfigKeys(mergedConfig);
        }
      }

      if (
        request.body.enabled !== undefined &&
        provider !== INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS &&
        provider !== INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT
      ) {
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
