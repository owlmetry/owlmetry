import type { FastifyInstance } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import { projectIntegrations, appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { mergeUserProperties, selectUnsetProps } from "../utils/user-properties.js";
import type { AppleAdsConfig } from "../utils/apple-ads/config.js";
import { getAppleAdsAcls } from "../utils/apple-ads/client.js";
import { enrichAppleAdsNames } from "../utils/apple-ads/enrich.js";

async function findActiveAppleAdsIntegration(db: Db, projectId: string) {
  const [integration] = await db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.project_id, projectId),
        eq(projectIntegrations.provider, "apple-search-ads"),
        isNull(projectIntegrations.deleted_at),
        eq(projectIntegrations.enabled, true),
      ),
    )
    .limit(1);
  return integration ?? null;
}

export async function appleSearchAdsRoutes(app: FastifyInstance) {
  // Test connection — validates credentials by calling GET /api/v5/acls.
  // Lets the UI surface "signature invalid" / "Apple rejected credentials"
  // errors inline, and returns the list of orgs so the customer can confirm
  // their org_id matches what they expect.
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/integrations/apple-search-ads/test",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const integration = await findActiveAppleAdsIntegration(app.db, projectId);
      if (!integration) {
        return reply.code(404).send({ error: "Apple Search Ads integration not found or disabled" });
      }

      const adsConfig = integration.config as unknown as AppleAdsConfig;
      const result = await getAppleAdsAcls({
        client_id: adsConfig.client_id,
        team_id: adsConfig.team_id,
        key_id: adsConfig.key_id,
        private_key_pem: adsConfig.private_key_pem,
      });

      if (result.status === "auth_error") {
        return reply.code(400).send({ ok: false, error: "auth_error", message: result.message });
      }
      if (result.status === "error") {
        return reply.code(502).send({ ok: false, error: "upstream_error", statusCode: result.statusCode, message: result.message });
      }
      if (result.status === "not_found") {
        return reply.code(404).send({ ok: false, error: "no_orgs", message: "Apple Ads returned no accessible orgs for these credentials" });
      }

      const orgs = result.data.map((o) => ({
        org_id: o.orgId,
        org_name: o.orgName,
        matches_configured_org_id: String(o.orgId) === adsConfig.org_id,
      }));
      return { ok: true, orgs };
    },
  );

  // Bulk sync — queues the apple_ads_sync job to enrich every user with
  // `asa_campaign_id` but missing names.
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/integrations/apple-search-ads/sync",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const integration = await findActiveAppleAdsIntegration(app.db, projectId);
      if (!integration) {
        return reply.code(404).send({ error: "Apple Search Ads integration not found or disabled" });
      }

      const users = await app.db
        .select({ user_id: appUsers.user_id })
        .from(appUsers)
        .where(eq(appUsers.project_id, projectId));

      if (users.length === 0) {
        return { syncing: false, total: 0 };
      }

      const triggeredBy =
        request.auth.type === "user"
          ? `manual:user:${request.auth.user_id}`
          : `manual:api_key:${request.auth.key_id}`;

      const run = await app.jobRunner.trigger("apple_ads_sync", {
        triggeredBy,
        teamId: project.team_id,
        projectId,
        params: { project_id: projectId },
      });

      return { syncing: true, total: users.length, job_run_id: run.id };
    },
  );

  // Single-user sync — synchronous. Used right after attribution resolves
  // (via the fire-and-forget hook in attributionRoutes), and available as a
  // direct tool for dashboards/agents poking at a specific user.
  app.post<{ Params: { projectId: string; userId: string } }>(
    "/projects/:projectId/integrations/apple-search-ads/sync/:userId",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId, userId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const integration = await findActiveAppleAdsIntegration(app.db, projectId);
      if (!integration) {
        return reply.code(404).send({ error: "Apple Search Ads integration not found or disabled" });
      }

      const [userRow] = await app.db
        .select({ properties: appUsers.properties })
        .from(appUsers)
        .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, userId)))
        .limit(1);

      if (!userRow) {
        return reply.code(404).send({ error: "User not found" });
      }

      const currentProps = (userRow.properties ?? {}) as Record<string, unknown>;
      const adsConfig = integration.config as unknown as AppleAdsConfig;
      const outcome = await enrichAppleAdsNames(adsConfig, currentProps);

      if (outcome.authError) {
        return reply.code(400).send({ error: "auth_error", message: outcome.authError });
      }

      const unsetProps = selectUnsetProps(outcome.props, currentProps);
      if (Object.keys(unsetProps).length === 0) {
        return { updated: 0, properties: {}, field_errors: outcome.fieldErrors };
      }

      await mergeUserProperties(app.db, projectId, userId, unsetProps);
      return { updated: Object.keys(unsetProps).length, properties: unsetProps, field_errors: outcome.fieldErrors };
    },
  );
}

/**
 * Fire-and-forget enrichment, called right after the attribution route writes
 * the numeric IDs. Looks up the project's apple-search-ads integration (if
 * enabled) and POSTs names to user properties via `selectUnsetProps` so RC or
 * a prior run never gets overwritten. Failures are logged, not thrown — this
 * must never break the attribution response.
 */
export async function scheduleAppleAdsEnrichmentForUser(
  app: FastifyInstance,
  projectId: string,
  userId: string,
  knownProps: Record<string, string>,
): Promise<void> {
  try {
    const integration = await findActiveAppleAdsIntegration(app.db, projectId);
    if (!integration) return;

    const [userRow] = await app.db
      .select({ properties: appUsers.properties })
      .from(appUsers)
      .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, userId)))
      .limit(1);

    // Merge what we just wrote with what's already stored — the JSONB merge is
    // async-safe but by reading once here we avoid re-fetching inside
    // enrichAppleAdsNames.
    const currentProps: Record<string, unknown> = {
      ...((userRow?.properties ?? {}) as Record<string, unknown>),
      ...knownProps,
    };

    if (!currentProps.asa_campaign_id) return;

    const outcome = await enrichAppleAdsNames(
      integration.config as unknown as AppleAdsConfig,
      currentProps,
    );

    if (outcome.authError) {
      app.log.warn(
        { projectId, userId, message: outcome.authError },
        "Apple Ads enrichment skipped — auth error. Surface via integrations page.",
      );
      return;
    }

    for (const fe of outcome.fieldErrors) {
      app.log.warn(
        { projectId, userId, field: fe.field, statusCode: fe.statusCode, message: fe.message },
        "Apple Ads field lookup failed during inline enrichment",
      );
    }

    const unsetProps = selectUnsetProps(outcome.props, currentProps);
    if (Object.keys(unsetProps).length > 0) {
      await mergeUserProperties(app.db, projectId, userId, unsetProps);
    }
  } catch (err) {
    app.log.warn({ err, projectId, userId }, "Apple Ads enrichment failed (fire-and-forget)");
  }
}
