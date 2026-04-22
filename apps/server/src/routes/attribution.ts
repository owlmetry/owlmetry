import type { FastifyInstance } from "fastify";
import {
  ATTRIBUTION_DEV_MOCKS,
  ATTRIBUTION_NETWORKS,
  type AttributionDevMock,
  type AttributionNetwork,
  type SubmitAppleSearchAdsAttributionRequest,
  type SubmitAppleSearchAdsAttributionResponse,
} from "@owlmetry/shared";
import { requirePermission } from "../middleware/auth.js";
import { mergeUserProperties } from "../utils/user-properties.js";
import { resolveProjectIdFromApp } from "../utils/project.js";
import { ATTRIBUTION_RESOLVERS } from "../utils/attribution/index.js";
import { scheduleAppleAdsEnrichmentForUser } from "./apple-search-ads.js";

function isAttributionNetwork(value: string): value is AttributionNetwork {
  return (ATTRIBUTION_NETWORKS as readonly string[]).includes(value);
}

function parseDevMock(value: unknown): AttributionDevMock | null {
  if (typeof value !== "string") return null;
  if ((ATTRIBUTION_DEV_MOCKS as readonly string[]).includes(value)) {
    return value as AttributionDevMock;
  }
  return null;
}

export async function attributionRoutes(app: FastifyInstance) {
  app.post<{
    Params: { source: string };
    Body: SubmitAppleSearchAdsAttributionRequest;
  }>(
    "/identity/attribution/:source",
    { preHandler: [requirePermission("users:write")] },
    async (request, reply) => {
      const { source } = request.params;
      if (!isAttributionNetwork(source)) {
        return reply.code(400).send({ error: `Unknown attribution source: ${source}` });
      }

      const { user_id, attribution_token, dev_mock } = request.body ?? ({} as SubmitAppleSearchAdsAttributionRequest);

      if (!user_id || typeof user_id !== "string") {
        return reply.code(400).send({ error: "user_id is required" });
      }
      if (typeof attribution_token !== "string") {
        return reply.code(400).send({ error: "attribution_token is required" });
      }

      const auth = request.auth;
      const app_id = auth.type === "api_key" ? auth.app_id : null;
      if (!app_id) {
        return reply.code(400).send({ error: "Client key must be scoped to an app" });
      }

      const project_id = await resolveProjectIdFromApp(app, app_id);
      if (!project_id) {
        return reply.code(400).send({ error: "App not found" });
      }

      const resolver = ATTRIBUTION_RESOLVERS[source];
      const devMock = parseDevMock(dev_mock);

      const outcome = await resolver.resolve(attribution_token, { devMock });

      switch (outcome.status) {
        case "resolved": {
          await mergeUserProperties(app.db, project_id, user_id, outcome.properties);
          // Fire-and-forget: if this project has the Apple Ads integration
          // configured, resolve IDs → names in the background so the dashboard
          // shows "Holiday US Campaign" instead of "542370539" within seconds.
          // Errors are logged inside the helper — never surfaced to the SDK.
          if (source === "apple-search-ads" && outcome.attributed) {
            void scheduleAppleAdsEnrichmentForUser(app, project_id, user_id, outcome.properties);
          }
          const response: SubmitAppleSearchAdsAttributionResponse = {
            attributed: outcome.attributed,
            pending: false,
            properties: outcome.properties,
          };
          return response;
        }
        case "pending": {
          const response: SubmitAppleSearchAdsAttributionResponse = {
            attributed: null,
            pending: true,
            retry_after_seconds: outcome.retryAfterSeconds,
            properties: {},
          };
          return response;
        }
        case "invalid": {
          return reply.code(400).send({ error: "Attribution token rejected by upstream", reason: outcome.reason });
        }
        case "upstream_error": {
          app.log.warn(
            { source, upstreamStatus: outcome.upstreamStatus, message: outcome.message },
            "Attribution upstream error",
          );
          return reply.code(502).send({
            error: "Attribution upstream error",
            statusCode: outcome.upstreamStatus,
            message: outcome.message,
          });
        }
      }
    },
  );
}
