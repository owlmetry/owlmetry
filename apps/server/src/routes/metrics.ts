import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, and, inArray, isNull, isNotNull, sql, desc, gte, lte } from "drizzle-orm";
import { metricDefinitions, metricEvents, projects, apps } from "@owlmetry/db";
import { parseTimeParam, validateMetricSlug, PG_UNIQUE_VIOLATION, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, METRIC_PHASES } from "@owlmetry/shared";
import type {
  CreateMetricDefinitionRequest,
  UpdateMetricDefinitionRequest,
  MetricQueryParams,
  MetricEventsQueryParams,
  MetricAggregationResult,
  MetricPhase,
} from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds, hasTeamAccess, assertTeamRole } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { dataModeToDrizzle } from "../utils/data-mode.js";
import { resolveProject, resolveProjectAppIds } from "../utils/project.js";

function serializeMetricDefinition(row: typeof metricDefinitions.$inferSelect) {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    documentation: row.documentation,
    schema_definition: row.schema_definition,
    aggregation_rules: row.aggregation_rules,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

const EMPTY_AGGREGATION: MetricAggregationResult = {
  total_count: 0,
  start_count: 0,
  complete_count: 0,
  fail_count: 0,
  cancel_count: 0,
  record_count: 0,
  success_rate: null,
  duration_avg_ms: null,
  duration_p50_ms: null,
  duration_p95_ms: null,
  duration_p99_ms: null,
  unique_users: 0,
  error_breakdown: [],
};

/** Routes nested under /v1/projects/:projectId */
export async function metricsRoutes(app: FastifyInstance) {
  // List metric definitions for a project
  app.get<{ Params: { projectId: string } }>(
    "/metrics",
    { preHandler: requirePermission("metrics:read") },
    async (request, reply) => {
      const { projectId } = request.params;

      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const rows = await app.db
        .select()
        .from(metricDefinitions)
        .where(
          and(
            eq(metricDefinitions.project_id, projectId),
            isNull(metricDefinitions.deleted_at),
          ),
        );

      return { metrics: rows.map(serializeMetricDefinition) };
    },
  );

  // Get single metric definition by slug
  app.get<{ Params: { projectId: string; slug: string } }>(
    "/metrics/:slug",
    { preHandler: requirePermission("metrics:read") },
    async (request, reply) => {
      const { projectId, slug } = request.params;

      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const [metric] = await app.db
        .select()
        .from(metricDefinitions)
        .where(
          and(
            eq(metricDefinitions.project_id, projectId),
            eq(metricDefinitions.slug, slug),
            isNull(metricDefinitions.deleted_at),
          ),
        )
        .limit(1);

      if (!metric) {
        return reply.code(404).send({ error: "Metric not found" });
      }

      return serializeMetricDefinition(metric);
    },
  );

  // Create metric definition
  app.post<{ Params: { projectId: string }; Body: CreateMetricDefinitionRequest }>(
    "/metrics",
    { preHandler: requirePermission("metrics:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { projectId } = request.params;
      const { name, slug, description, documentation, schema_definition, aggregation_rules } = request.body;

      if (!name || !slug) {
        return reply.code(400).send({ error: "name and slug are required" });
      }

      const slugError = validateMetricSlug(slug);
      if (slugError) {
        return reply.code(400).send({ error: slugError });
      }

      const project = await resolveProject(app, projectId, auth, reply);
      if (!project) return;

      if (!hasTeamAccess(auth, project.team_id)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      const roleError = assertTeamRole(auth, project.team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      // Resurrect soft-deleted metric with same slug (preserves UUID and event history)
      const [existing] = await app.db
        .select()
        .from(metricDefinitions)
        .where(
          and(
            eq(metricDefinitions.project_id, projectId),
            eq(metricDefinitions.slug, slug),
            isNotNull(metricDefinitions.deleted_at),
          ),
        )
        .limit(1);

      if (existing) {
        const [restored] = await app.db
          .update(metricDefinitions)
          .set({
            name,
            description: description ?? null,
            documentation: documentation ?? null,
            schema_definition: schema_definition ?? null,
            aggregation_rules: aggregation_rules ?? null,
            deleted_at: null,
          })
          .where(eq(metricDefinitions.id, existing.id))
          .returning();

        logAuditEvent(app.db, auth, {
          team_id: project.team_id,
          action: "create",
          resource_type: "metric_definition",
          resource_id: restored.id,
          metadata: { name, slug, resurrected: true },
        });

        return reply.code(201).send(serializeMetricDefinition(restored));
      }

      try {
        const [created] = await app.db
          .insert(metricDefinitions)
          .values({
            project_id: projectId,
            name,
            slug,
            description: description ?? null,
            documentation: documentation ?? null,
            schema_definition: schema_definition ?? null,
            aggregation_rules: aggregation_rules ?? null,
          })
          .returning();

        logAuditEvent(app.db, auth, {
          team_id: project.team_id,
          action: "create",
          resource_type: "metric_definition",
          resource_id: created.id,
          metadata: { name, slug },
        });

        return reply.code(201).send(serializeMetricDefinition(created));
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({ error: "A metric with this slug already exists in this project" });
        }
        throw err;
      }
    },
  );

  // Update metric definition
  app.patch<{ Params: { projectId: string; slug: string }; Body: UpdateMetricDefinitionRequest }>(
    "/metrics/:slug",
    { preHandler: requirePermission("metrics:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { projectId, slug } = request.params;
      const { name, description, documentation, schema_definition, aggregation_rules } = request.body;

      const teamIds = getAuthTeamIds(auth);
      const [metric] = await app.db
        .select()
        .from(metricDefinitions)
        .innerJoin(projects, eq(projects.id, metricDefinitions.project_id))
        .where(
          and(
            eq(metricDefinitions.project_id, projectId),
            eq(metricDefinitions.slug, slug),
            isNull(metricDefinitions.deleted_at),
            inArray(projects.team_id, teamIds),
            isNull(projects.deleted_at),
          ),
        )
        .limit(1);

      if (!metric) {
        return reply.code(404).send({ error: "Metric not found" });
      }

      const roleError = assertTeamRole(auth, metric.projects.team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const updates: Partial<typeof metricDefinitions.$inferInsert> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (documentation !== undefined) updates.documentation = documentation;
      if (schema_definition !== undefined) updates.schema_definition = schema_definition;
      if (aggregation_rules !== undefined) updates.aggregation_rules = aggregation_rules;

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const [updated] = await app.db
        .update(metricDefinitions)
        .set(updates)
        .where(eq(metricDefinitions.id, metric.metric_definitions.id))
        .returning();

      const changes: Record<string, { before?: unknown; after?: unknown }> = {};
      if (name !== undefined) changes.name = { before: metric.metric_definitions.name, after: name };
      if (Object.keys(changes).length > 0) {
        logAuditEvent(app.db, auth, {
          team_id: metric.projects.team_id,
          action: "update",
          resource_type: "metric_definition",
          resource_id: metric.metric_definitions.id,
          changes,
        });
      }

      return serializeMetricDefinition(updated);
    },
  );

  // Delete metric definition (soft delete)
  app.delete<{ Params: { projectId: string; slug: string } }>(
    "/metrics/:slug",
    { preHandler: requirePermission("metrics:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { projectId, slug } = request.params;

      const teamIds = getAuthTeamIds(auth);
      const [metric] = await app.db
        .select()
        .from(metricDefinitions)
        .innerJoin(projects, eq(projects.id, metricDefinitions.project_id))
        .where(
          and(
            eq(metricDefinitions.project_id, projectId),
            eq(metricDefinitions.slug, slug),
            isNull(metricDefinitions.deleted_at),
            inArray(projects.team_id, teamIds),
            isNull(projects.deleted_at),
          ),
        )
        .limit(1);

      if (!metric) {
        return reply.code(404).send({ error: "Metric not found" });
      }

      const roleError = assertTeamRole(auth, metric.projects.team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      await app.db
        .update(metricDefinitions)
        .set({ deleted_at: new Date() })
        .where(eq(metricDefinitions.id, metric.metric_definitions.id));

      logAuditEvent(app.db, auth, {
        team_id: metric.projects.team_id,
        action: "delete",
        resource_type: "metric_definition",
        resource_id: metric.metric_definitions.id,
        metadata: { slug },
      });

      return { deleted: true };
    },
  );

  // Aggregation endpoint
  app.get<{ Params: { projectId: string; slug: string }; Querystring: MetricQueryParams }>(
    "/metrics/:slug/query",
    { preHandler: requirePermission("metrics:read") },
    async (request, reply) => {
      const { projectId, slug } = request.params;
      const { since, until, app_id, app_version, device_model, os_version, user_id, environment, group_by, data_mode } = request.query;

      const appIds = await resolveProjectAppIds(app, projectId, request.auth, reply);
      if (!appIds) return;

      // Filter to specific app if requested
      const filteredAppIds = app_id ? appIds.filter((id) => id === app_id) : appIds;
      if (filteredAppIds.length === 0) {
        return { slug, aggregation: EMPTY_AGGREGATION };
      }

      // Build Drizzle conditions for metric_events
      const conditions = [
        inArray(metricEvents.app_id, filteredAppIds),
        eq(metricEvents.metric_slug, slug),
      ];

      // Time range (default 24h)
      const sinceDate = since ? parseTimeParam(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      conditions.push(gte(metricEvents.timestamp, sinceDate));

      if (until) conditions.push(lte(metricEvents.timestamp, parseTimeParam(until)));
      if (app_version) conditions.push(eq(metricEvents.app_version, app_version));
      if (device_model) conditions.push(eq(metricEvents.device_model, device_model));
      if (os_version) conditions.push(eq(metricEvents.os_version, os_version));
      if (user_id) conditions.push(eq(metricEvents.user_id, user_id));
      if (environment) conditions.push(eq(metricEvents.environment, environment as typeof metricEvents.environment.enumValues[number]));

      const devCondition = dataModeToDrizzle(metricEvents.is_dev, data_mode);
      if (devCondition) conditions.push(devCondition);

      const whereExpr = and(...conditions);

      // Main aggregation query
      const aggResult = await app.db
        .select({
          total_count: sql<number>`COUNT(*)::int`,
          start_count: sql<number>`COUNT(*) FILTER (WHERE ${metricEvents.phase} = 'start')::int`,
          complete_count: sql<number>`COUNT(*) FILTER (WHERE ${metricEvents.phase} = 'complete')::int`,
          fail_count: sql<number>`COUNT(*) FILTER (WHERE ${metricEvents.phase} = 'fail')::int`,
          cancel_count: sql<number>`COUNT(*) FILTER (WHERE ${metricEvents.phase} = 'cancel')::int`,
          record_count: sql<number>`COUNT(*) FILTER (WHERE ${metricEvents.phase} = 'record')::int`,
          duration_avg_ms: sql<number | null>`AVG(${metricEvents.duration_ms}) FILTER (WHERE ${metricEvents.duration_ms} IS NOT NULL)`,
          duration_p50_ms: sql<number | null>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${metricEvents.duration_ms}) FILTER (WHERE ${metricEvents.duration_ms} IS NOT NULL)`,
          duration_p95_ms: sql<number | null>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${metricEvents.duration_ms}) FILTER (WHERE ${metricEvents.duration_ms} IS NOT NULL)`,
          duration_p99_ms: sql<number | null>`PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${metricEvents.duration_ms}) FILTER (WHERE ${metricEvents.duration_ms} IS NOT NULL)`,
          unique_users: sql<number>`COUNT(DISTINCT ${metricEvents.user_id})::int`,
        })
        .from(metricEvents)
        .where(whereExpr);

      const agg = aggResult[0];

      // Success rate: complete / (complete + fail)
      const completeCount = agg.complete_count ?? 0;
      const failCount = agg.fail_count ?? 0;
      const successDenom = completeCount + failCount;
      const successRate = successDenom > 0 ? Math.round((completeCount / successDenom) * 10000) / 100 : null;

      // Error breakdown
      const errorResult = await app.db
        .select({
          error: metricEvents.error,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(metricEvents)
        .where(and(...conditions, eq(metricEvents.phase, "fail" as MetricPhase), sql`${metricEvents.error} IS NOT NULL`))
        .groupBy(metricEvents.error)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(20);

      // Group by (optional)
      interface GroupRow {
        key: string;
        value: string;
        total_count: number;
        complete_count: number;
        fail_count: number;
        success_rate: number | null;
        duration_avg_ms: number | null;
      }
      let groups: GroupRow[] | undefined;
      if (group_by) {
        let groupExpr: ReturnType<typeof sql>;
        let orderAsc = false;

        if (group_by === "time:hour") {
          groupExpr = sql`date_trunc('hour', ${metricEvents.timestamp})`;
          orderAsc = true;
        } else if (group_by === "time:day") {
          groupExpr = sql`date_trunc('day', ${metricEvents.timestamp})`;
          orderAsc = true;
        } else if (group_by === "time:week") {
          groupExpr = sql`date_trunc('week', ${metricEvents.timestamp})`;
          orderAsc = true;
        } else if (group_by === "app_id") {
          groupExpr = sql`${metricEvents.app_id}`;
        } else if (group_by === "app_version") {
          groupExpr = sql`${metricEvents.app_version}`;
        } else if (group_by === "device_model") {
          groupExpr = sql`${metricEvents.device_model}`;
        } else if (group_by === "os_version") {
          groupExpr = sql`${metricEvents.os_version}`;
        } else if (group_by === "environment") {
          groupExpr = sql`${metricEvents.environment}`;
        } else {
          return reply.code(400).send({ error: `Invalid group_by value: ${group_by}` });
        }

        const groupResult = await app.db
          .select({
            value: sql<string>`${groupExpr}::text`,
            total_count: sql<number>`COUNT(*)::int`,
            complete_count: sql<number>`COUNT(*) FILTER (WHERE ${metricEvents.phase} = 'complete')::int`,
            fail_count: sql<number>`COUNT(*) FILTER (WHERE ${metricEvents.phase} = 'fail')::int`,
            duration_avg_ms: sql<number | null>`AVG(${metricEvents.duration_ms}) FILTER (WHERE ${metricEvents.duration_ms} IS NOT NULL)`,
          })
          .from(metricEvents)
          .where(whereExpr)
          .groupBy(groupExpr)
          .orderBy(orderAsc ? sql`${groupExpr} ASC` : sql`COUNT(*) DESC`)
          .limit(100);

        groups = groupResult.map((row) => {
          const cd = (row.complete_count ?? 0) + (row.fail_count ?? 0);
          return {
            key: group_by,
            value: row.value,
            total_count: row.total_count,
            complete_count: row.complete_count ?? 0,
            fail_count: row.fail_count ?? 0,
            success_rate: cd > 0 ? Math.round(((row.complete_count ?? 0) / cd) * 10000) / 100 : null,
            duration_avg_ms: row.duration_avg_ms != null ? Math.round(Number(row.duration_avg_ms) * 100) / 100 : null,
          };
        });
      }

      return {
        slug,
        aggregation: {
          total_count: agg.total_count ?? 0,
          start_count: agg.start_count ?? 0,
          complete_count: completeCount,
          fail_count: failCount,
          cancel_count: agg.cancel_count ?? 0,
          record_count: agg.record_count ?? 0,
          success_rate: successRate,
          duration_avg_ms: agg.duration_avg_ms != null ? Math.round(Number(agg.duration_avg_ms) * 100) / 100 : null,
          duration_p50_ms: agg.duration_p50_ms != null ? Math.round(Number(agg.duration_p50_ms) * 100) / 100 : null,
          duration_p95_ms: agg.duration_p95_ms != null ? Math.round(Number(agg.duration_p95_ms) * 100) / 100 : null,
          duration_p99_ms: agg.duration_p99_ms != null ? Math.round(Number(agg.duration_p99_ms) * 100) / 100 : null,
          unique_users: agg.unique_users ?? 0,
          error_breakdown: errorResult.map((r) => ({ error: r.error, count: r.count })),
          ...(groups ? { groups } : {}),
        },
      };
    },
  );

  // Raw metric events endpoint (paginated)
  app.get<{ Params: { projectId: string; slug: string }; Querystring: MetricEventsQueryParams }>(
    "/metrics/:slug/events",
    { preHandler: requirePermission("metrics:read") },
    async (request, reply) => {
      const { projectId, slug } = request.params;
      const { phase, tracking_id, user_id, environment, since, until, cursor, limit: limitStr, data_mode } = request.query;

      const appIds = await resolveProjectAppIds(app, projectId, request.auth, reply);
      if (!appIds) return;

      if (appIds.length === 0) {
        return { events: [], cursor: null, has_more: false };
      }

      const limit = Math.min(Math.max(Number(limitStr) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

      const conditions = [
        inArray(metricEvents.app_id, appIds),
        eq(metricEvents.metric_slug, slug),
      ];

      if (phase && METRIC_PHASES.includes(phase as MetricPhase)) {
        conditions.push(eq(metricEvents.phase, phase as MetricPhase));
      }
      if (tracking_id) conditions.push(eq(metricEvents.tracking_id, tracking_id));
      if (user_id) conditions.push(eq(metricEvents.user_id, user_id));
      if (environment) conditions.push(eq(metricEvents.environment, environment as typeof metricEvents.environment.enumValues[number]));
      if (since) conditions.push(gte(metricEvents.timestamp, parseTimeParam(since)));
      if (until) conditions.push(lte(metricEvents.timestamp, parseTimeParam(until)));
      const devCondition = dataModeToDrizzle(metricEvents.is_dev, data_mode);
      if (devCondition) conditions.push(devCondition);
      if (cursor) conditions.push(lte(metricEvents.timestamp, new Date(cursor)));

      const rows = await app.db
        .select()
        .from(metricEvents)
        .where(and(...conditions))
        .orderBy(desc(metricEvents.timestamp))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? pageRows[pageRows.length - 1].timestamp.toISOString() : null;

      return {
        events: pageRows.map((r) => ({
          ...r,
          timestamp: r.timestamp.toISOString(),
          received_at: r.received_at.toISOString(),
        })),
        cursor: nextCursor,
        has_more: hasMore,
      };
    },
  );
}

/** Standalone by-id endpoint registered at /v1 prefix */
export async function metricByIdRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    "/metrics/by-id/:id",
    { preHandler: requirePermission("metrics:read") },
    async (request, reply) => {
      const { id } = request.params;
      const teamIds = getAuthTeamIds(request.auth);

      const [result] = await app.db
        .select()
        .from(metricDefinitions)
        .innerJoin(projects, eq(projects.id, metricDefinitions.project_id))
        .where(
          and(
            eq(metricDefinitions.id, id),
            isNull(metricDefinitions.deleted_at),
            inArray(projects.team_id, teamIds),
            isNull(projects.deleted_at),
          ),
        )
        .limit(1);

      if (!result) {
        return reply.code(404).send({ error: "Metric not found" });
      }

      return serializeMetricDefinition(result.metric_definitions);
    },
  );
}
