import type { FastifyInstance } from "fastify";
import { eq, and, desc, isNotNull, isNull } from "drizzle-orm";
import { apps, jobRuns } from "@owlmetry/db";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { findActiveIntegration, formatManualTriggeredBy } from "../utils/integrations.js";
import { INTEGRATION_PROVIDER_IDS } from "@owlmetry/shared";
import type { AppStoreConnectConfig } from "../utils/app-store-connect/config.js";
import { listAppStoreConnectApps } from "../utils/app-store-connect/client.js";

const PROVIDER = INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT;

export async function appStoreConnectRoutes(app: FastifyInstance) {
  // Status: returns the most recent app_store_connect_reviews_sync run for
  // this project so the dashboard's last-sync strip can show "last sync
  // aborted — bad credentials" inline.
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/integrations/app-store-connect/status",
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
            eq(jobRuns.job_type, "app_store_connect_reviews_sync"),
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
          // Re-shape to match the ASA last-sync strip's keys so the same
          // <LastSyncStrip> component renders both providers.
          enriched: typeof result.reviews_ingested === "number" ? result.reviews_ingested : 0,
          examined: typeof result.pages_fetched === "number" ? result.pages_fetched : 0,
          errors: typeof result.errors === "number" ? result.errors : 0,
          error_status_counts: errorStatusCounts,
        },
      };
    },
  );

  // Test connection — validates the .p8 against ASC by listing accessible apps.
  // The returned `apps` list lets the operator confirm the right ASC team is
  // connected and that their bundle IDs are visible. Doubles as the setup-time
  // discovery call (no separate /discover-apps endpoint needed).
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/integrations/app-store-connect/test",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const integration = await findActiveIntegration(app.db, projectId, PROVIDER);
      if (!integration) {
        return reply.code(404).send({ error: "App Store Connect integration not found or disabled" });
      }

      const ascConfig = integration.config as unknown as AppStoreConnectConfig;
      const result = await listAppStoreConnectApps(ascConfig);

      if (result.status === "auth_error") {
        return reply.code(400).send({ error: result.message });
      }
      if (result.status === "rate_limited") {
        return reply
          .code(429)
          .header("Retry-After", String(result.retryAfterSeconds))
          .send({ error: result.message });
      }
      if (result.status === "error") {
        return reply.code(502).send({ error: `App Store Connect returned ${result.statusCode}: ${result.message}` });
      }
      if (result.status === "not_found" || result.data.length === 0) {
        return reply.code(404).send({ error: "App Store Connect returned no accessible apps for this key" });
      }

      return {
        ok: true,
        apps: result.data.map((a) => ({ id: a.id, name: a.name, bundle_id: a.bundleId })),
      };
    },
  );

  // Bulk sync — queues the app_store_connect_reviews_sync job for this
  // project. Returns 400 if the project has no Apple apps with a populated
  // apple_app_store_id — those are the ones the job actually processes.
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/integrations/app-store-connect/sync",
    { preHandler: [requirePermission("integrations:write")] },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const integration = await findActiveIntegration(app.db, projectId, PROVIDER);
      if (!integration) {
        return reply.code(404).send({ error: "App Store Connect integration not found or disabled" });
      }

      const eligibleApps = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(
          and(
            eq(apps.project_id, projectId),
            eq(apps.platform, "apple"),
            isNotNull(apps.apple_app_store_id),
            isNull(apps.deleted_at),
          ),
        );

      if (eligibleApps.length === 0) {
        return { syncing: false, total: 0 };
      }

      const run = await app.jobRunner.trigger("app_store_connect_reviews_sync", {
        triggeredBy: formatManualTriggeredBy(request.auth),
        teamId: project.team_id,
        projectId,
        params: { project_id: projectId },
      });

      return { syncing: true, total: eligibleApps.length, job_run_id: run.id };
    },
  );
}
