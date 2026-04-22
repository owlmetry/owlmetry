import type { FastifyInstance } from "fastify";
import { eq, and, desc } from "drizzle-orm";
import { appUsers, jobRuns } from "@owlmetry/db";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { mergeUserProperties, selectUnsetProps } from "../utils/user-properties.js";
import { findActiveIntegration, formatManualTriggeredBy } from "../utils/integrations.js";
import type { AppleAdsAuthConfig, AppleAdsConfig } from "../utils/apple-ads/config.js";
import { getAppleAdsAcls } from "../utils/apple-ads/client.js";
import { enrichAppleAdsNames, buildEnrichmentDiagnostic } from "../utils/apple-ads/enrich.js";

const PROVIDER = "apple-search-ads";

export async function appleSearchAdsRoutes(app: FastifyInstance) {
  // Status: returns the most recent apple_ads_sync run for this project so the
  // dashboard can surface "last sync aborted — bad credentials" inline without
  // requiring the user to dig through the Jobs list.
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/integrations/apple-search-ads/status",
    { preHandler: [requirePermission("integrations:read")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [lastRun] = await app.db
        .select()
        .from(jobRuns)
        .where(
          and(
            eq(jobRuns.project_id, projectId),
            eq(jobRuns.job_type, "apple_ads_sync"),
          ),
        )
        .orderBy(desc(jobRuns.created_at))
        .limit(1);

      if (!lastRun) {
        return { last_sync: null };
      }

      const result = (lastRun.result ?? {}) as Record<string, unknown>;
      const aborted = result.aborted === true;
      const abortReason = typeof result.abort_reason === "string" ? result.abort_reason : null;
      const errorStatusCounts = (result.error_status_counts ?? {}) as Record<string, number>;

      return {
        last_sync: {
          id: lastRun.id,
          status: lastRun.status,
          created_at: lastRun.created_at.toISOString(),
          completed_at: lastRun.completed_at?.toISOString() ?? null,
          aborted,
          abort_reason: abortReason,
          enriched: typeof result.enriched === "number" ? result.enriched : 0,
          examined: typeof result.examined === "number" ? result.examined : 0,
          errors: typeof result.errors === "number" ? result.errors : 0,
          error_status_counts: errorStatusCounts,
        },
      };
    },
  );

  // Discover orgs — called during the connect flow *before* the integration
  // is saved. Accepts the 4 credential fields (no org_id), mints an access
  // token, and returns the list of orgs visible to those credentials so the
  // customer can pick one from a dropdown instead of hunting for the
  // "Account ID" in ads.apple.com.
  app.post<{
    Params: { projectId: string };
    Body: {
      client_id?: string;
      team_id?: string;
      key_id?: string;
      private_key_pem?: string;
    };
  }>(
    "/projects/:projectId/integrations/apple-search-ads/discover-orgs",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const { client_id, team_id, key_id, private_key_pem } = request.body ?? {};
      if (!client_id || !team_id || !key_id || !private_key_pem) {
        return reply.code(400).send({ error: "client_id, team_id, key_id, and private_key_pem are required" });
      }

      const authConfig: AppleAdsAuthConfig = { client_id, team_id, key_id, private_key_pem };
      const result = await getAppleAdsAcls(authConfig);

      if (result.status === "auth_error") {
        return reply.code(400).send({ error: result.message });
      }
      if (result.status === "error") {
        return reply.code(502).send({ error: `Apple Ads returned ${result.statusCode}: ${result.message}` });
      }
      if (result.status === "not_found" || result.data.length === 0) {
        return reply.code(404).send({ error: "Apple Ads returned no accessible orgs for these credentials" });
      }

      return {
        ok: true,
        orgs: result.data.map((o) => ({ org_id: o.orgId, org_name: o.orgName })),
      };
    },
  );

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

      const integration = await findActiveIntegration(app.db, projectId, PROVIDER);
      if (!integration) {
        return reply.code(404).send({ error: "Apple Search Ads integration not found or disabled" });
      }

      const adsConfig = integration.config as unknown as AppleAdsConfig;
      const result = await getAppleAdsAcls(adsConfig);

      if (result.status === "auth_error") {
        return reply.code(400).send({ error: result.message });
      }
      if (result.status === "error") {
        return reply.code(502).send({ error: `Apple Ads returned ${result.statusCode}: ${result.message}` });
      }
      if (result.status === "not_found") {
        return reply.code(404).send({ error: "Apple Ads returned no accessible orgs for these credentials" });
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

      const integration = await findActiveIntegration(app.db, projectId, PROVIDER);
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

      const run = await app.jobRunner.trigger("apple_ads_sync", {
        triggeredBy: formatManualTriggeredBy(request.auth),
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

      const integration = await findActiveIntegration(app.db, projectId, PROVIDER);
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
        // Stamp the failure on the user for debugability, then surface to the caller.
        const diagnostic = buildEnrichmentDiagnostic(outcome, 0);
        await mergeUserProperties(app.db, projectId, userId, diagnostic);
        return reply.code(400).send({ error: "auth_error", message: outcome.authError });
      }

      const unsetProps = selectUnsetProps(outcome.props, currentProps);
      const diagnostic = buildEnrichmentDiagnostic(outcome, Object.keys(unsetProps).length);
      await mergeUserProperties(app.db, projectId, userId, { ...unsetProps, ...diagnostic });
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
    // Short-circuit before any DB work when there's no campaign id to resolve —
    // unattributed installs are the common case and shouldn't pay for a lookup.
    if (!knownProps.asa_campaign_id) return;

    const integration = await findActiveIntegration(app.db, projectId, PROVIDER);
    if (!integration) return;

    const [userRow] = await app.db
      .select({ properties: appUsers.properties })
      .from(appUsers)
      .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, userId)))
      .limit(1);

    // Read existing props so we don't overwrite names a prior enrichment or
    // the RevenueCat backfill has already set.
    const existingProps: Record<string, unknown> = {
      ...((userRow?.properties ?? {}) as Record<string, unknown>),
      ...knownProps,
    };

    const outcome = await enrichAppleAdsNames(
      integration.config as unknown as AppleAdsConfig,
      existingProps,
    );

    if (outcome.authError) {
      app.log.warn(
        { projectId, userId, message: outcome.authError },
        "Apple Ads enrichment skipped — auth error. Surface via integrations page.",
      );
    }

    for (const fe of outcome.fieldErrors) {
      app.log.warn(
        { projectId, userId, field: fe.field, statusCode: fe.statusCode, message: fe.message },
        "Apple Ads field lookup failed during inline enrichment",
      );
    }

    const unsetProps = outcome.authError ? {} : selectUnsetProps(outcome.props, existingProps);
    const diagnostic = buildEnrichmentDiagnostic(outcome, Object.keys(unsetProps).length);
    await mergeUserProperties(app.db, projectId, userId, { ...unsetProps, ...diagnostic });
  } catch (err) {
    app.log.warn({ err, projectId, userId }, "Apple Ads enrichment failed (fire-and-forget)");
  }
}
