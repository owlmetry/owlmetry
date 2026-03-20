import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, sql, gte, lte, type SQL } from "drizzle-orm";
import { funnelDefinitions, funnelEvents, projects } from "@owlmetry/db";
import type {
  CreateFunnelRequest,
  UpdateFunnelRequest,
  FunnelQueryParams,
  FunnelStepAnalytics,
} from "@owlmetry/shared";
import { validateFunnelSlug, PG_UNIQUE_VIOLATION } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds, hasTeamAccess, assertTeamRole } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { dataModeToDrizzle } from "../utils/data-mode.js";
import { resolveProject, resolveProjectAppIds } from "../utils/project.js";

const MAX_FUNNEL_STEPS = 20;

function serializeFunnelDefinition(row: typeof funnelDefinitions.$inferSelect) {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    steps: row.steps,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function validateSteps(steps: unknown): string | null {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "steps must be a non-empty array";
  }
  if (steps.length > MAX_FUNNEL_STEPS) {
    return `Maximum ${MAX_FUNNEL_STEPS} steps allowed`;
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== "object") {
      return `steps[${i}]: must be an object`;
    }
    if (!step.name || typeof step.name !== "string") {
      return `steps[${i}]: name is required`;
    }
    if (!step.event_filter || typeof step.event_filter !== "object") {
      return `steps[${i}]: event_filter is required`;
    }
    const filter = step.event_filter;
    if (!filter.message && !filter.screen_name) {
      return `steps[${i}]: event_filter must have at least message or screen_name`;
    }
  }
  return null;
}

export async function funnelsRoutes(app: FastifyInstance) {
  // List funnel definitions for a project
  app.get<{ Querystring: { project_id?: string } }>(
    "/funnels",
    { preHandler: requirePermission("funnels:read") },
    async (request, reply) => {
      const { project_id } = request.query;
      if (!project_id) {
        return reply.code(400).send({ error: "project_id query parameter is required" });
      }

      const project = await resolveProject(app, project_id, request.auth, reply);
      if (!project) return;

      const rows = await app.db
        .select()
        .from(funnelDefinitions)
        .where(
          and(
            eq(funnelDefinitions.project_id, project_id),
            isNull(funnelDefinitions.deleted_at),
          ),
        );

      return { funnels: rows.map(serializeFunnelDefinition) };
    },
  );

  // Get single funnel definition by slug
  app.get<{ Params: { slug: string }; Querystring: { project_id?: string } }>(
    "/funnels/:slug",
    { preHandler: requirePermission("funnels:read") },
    async (request, reply) => {
      const { slug } = request.params;
      const { project_id } = request.query;
      if (!project_id) {
        return reply.code(400).send({ error: "project_id query parameter is required" });
      }

      const project = await resolveProject(app, project_id, request.auth, reply);
      if (!project) return;

      const [funnel] = await app.db
        .select()
        .from(funnelDefinitions)
        .where(
          and(
            eq(funnelDefinitions.project_id, project_id),
            eq(funnelDefinitions.slug, slug),
            isNull(funnelDefinitions.deleted_at),
          ),
        )
        .limit(1);

      if (!funnel) {
        return reply.code(404).send({ error: "Funnel not found" });
      }

      return serializeFunnelDefinition(funnel);
    },
  );

  // Create funnel definition
  app.post<{ Body: CreateFunnelRequest }>(
    "/funnels",
    { preHandler: requirePermission("funnels:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { project_id, name, slug, description, steps } = request.body;

      if (!project_id || !name || !slug) {
        return reply.code(400).send({ error: "project_id, name, and slug are required" });
      }

      const slugError = validateFunnelSlug(slug);
      if (slugError) {
        return reply.code(400).send({ error: slugError });
      }

      const stepsError = validateSteps(steps);
      if (stepsError) {
        return reply.code(400).send({ error: stepsError });
      }

      const project = await resolveProject(app, project_id, auth, reply);
      if (!project) return;

      if (!hasTeamAccess(auth, project.team_id)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      const roleError = assertTeamRole(auth, project.team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      try {
        const [created] = await app.db
          .insert(funnelDefinitions)
          .values({
            project_id,
            name,
            slug,
            description: description ?? null,
            steps,
          })
          .returning();

        logAuditEvent(app.db, auth, {
          team_id: project.team_id,
          action: "create",
          resource_type: "funnel_definition",
          resource_id: created.id,
          metadata: { name, slug },
        });

        return reply.code(201).send(serializeFunnelDefinition(created));
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({ error: "A funnel with this slug already exists in this project" });
        }
        throw err;
      }
    },
  );

  // Update funnel definition
  app.patch<{ Params: { slug: string }; Querystring: { project_id?: string }; Body: UpdateFunnelRequest }>(
    "/funnels/:slug",
    { preHandler: requirePermission("funnels:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { slug } = request.params;
      const { project_id } = request.query;
      const { name, description, steps } = request.body;

      if (!project_id) {
        return reply.code(400).send({ error: "project_id query parameter is required" });
      }

      if (steps !== undefined) {
        const stepsError = validateSteps(steps);
        if (stepsError) {
          return reply.code(400).send({ error: stepsError });
        }
      }

      const teamIds = getAuthTeamIds(auth);
      const [funnel] = await app.db
        .select()
        .from(funnelDefinitions)
        .innerJoin(projects, eq(projects.id, funnelDefinitions.project_id))
        .where(
          and(
            eq(funnelDefinitions.project_id, project_id),
            eq(funnelDefinitions.slug, slug),
            isNull(funnelDefinitions.deleted_at),
            inArray(projects.team_id, teamIds),
            isNull(projects.deleted_at),
          ),
        )
        .limit(1);

      if (!funnel) {
        return reply.code(404).send({ error: "Funnel not found" });
      }

      const roleError = assertTeamRole(auth, funnel.projects.team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const updates: Partial<typeof funnelDefinitions.$inferInsert> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (steps !== undefined) updates.steps = steps;

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const [updated] = await app.db
        .update(funnelDefinitions)
        .set(updates)
        .where(eq(funnelDefinitions.id, funnel.funnel_definitions.id))
        .returning();

      const changes: Record<string, { before?: unknown; after?: unknown }> = {};
      if (name !== undefined) changes.name = { before: funnel.funnel_definitions.name, after: name };
      if (Object.keys(changes).length > 0) {
        logAuditEvent(app.db, auth, {
          team_id: funnel.projects.team_id,
          action: "update",
          resource_type: "funnel_definition",
          resource_id: funnel.funnel_definitions.id,
          changes,
        });
      }

      return serializeFunnelDefinition(updated);
    },
  );

  // Delete funnel definition (soft delete, user-only)
  app.delete<{ Params: { slug: string }; Querystring: { project_id?: string } }>(
    "/funnels/:slug",
    { preHandler: requirePermission("funnels:write") },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete funnels" });
      }

      const { slug } = request.params;
      const { project_id } = request.query;

      if (!project_id) {
        return reply.code(400).send({ error: "project_id query parameter is required" });
      }

      const teamIds = getAuthTeamIds(auth);
      const [funnel] = await app.db
        .select()
        .from(funnelDefinitions)
        .innerJoin(projects, eq(projects.id, funnelDefinitions.project_id))
        .where(
          and(
            eq(funnelDefinitions.project_id, project_id),
            eq(funnelDefinitions.slug, slug),
            isNull(funnelDefinitions.deleted_at),
            inArray(projects.team_id, teamIds),
            isNull(projects.deleted_at),
          ),
        )
        .limit(1);

      if (!funnel) {
        return reply.code(404).send({ error: "Funnel not found" });
      }

      const roleError = assertTeamRole(auth, funnel.projects.team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      await app.db
        .update(funnelDefinitions)
        .set({ deleted_at: new Date() })
        .where(eq(funnelDefinitions.id, funnel.funnel_definitions.id));

      logAuditEvent(app.db, auth, {
        team_id: funnel.projects.team_id,
        action: "delete",
        resource_type: "funnel_definition",
        resource_id: funnel.funnel_definitions.id,
        metadata: { slug },
      });

      return { deleted: true };
    },
  );

  // Analytics query endpoint
  app.get<{ Params: { slug: string }; Querystring: FunnelQueryParams }>(
    "/funnels/:slug/query",
    { preHandler: requirePermission("funnels:read") },
    async (request, reply) => {
      const { slug } = request.params;
      const {
        project_id,
        since,
        until,
        app_id,
        app_version,
        environment,
        experiment,
        mode = "closed",
        group_by,
        data_mode,
      } = request.query;

      if (!project_id) {
        return reply.code(400).send({ error: "project_id query parameter is required" });
      }

      // Resolve project and get app IDs
      const appIds = await resolveProjectAppIds(app, project_id, request.auth, reply);
      if (!appIds) return;

      const filteredAppIds = app_id ? appIds.filter((id) => id === app_id) : appIds;

      // Look up funnel definition
      const teamIds = getAuthTeamIds(request.auth);
      const [funnel] = await app.db
        .select()
        .from(funnelDefinitions)
        .where(
          and(
            eq(funnelDefinitions.project_id, project_id),
            eq(funnelDefinitions.slug, slug),
            isNull(funnelDefinitions.deleted_at),
          ),
        )
        .limit(1);

      if (!funnel) {
        return reply.code(404).send({ error: "Funnel not found" });
      }

      const steps = funnel.steps;
      if (steps.length === 0 || filteredAppIds.length === 0) {
        return {
          slug,
          analytics: {
            funnel: serializeFunnelDefinition(funnel),
            mode,
            total_users: 0,
            steps: [],
          },
        };
      }

      // Build base conditions
      const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const untilDate = until ? new Date(until) : new Date();

      const result = await buildFunnelQuery(app, {
        appIds: filteredAppIds,
        steps,
        sinceDate,
        untilDate,
        mode: mode as "closed" | "open",
        dataMode: data_mode,
        environment,
        appVersion: app_version,
        experiment,
        groupBy: group_by,
      });

      return {
        slug,
        analytics: {
          funnel: serializeFunnelDefinition(funnel),
          mode,
          total_users: result.totalUsers,
          steps: result.steps,
          ...(result.breakdown ? { breakdown: result.breakdown } : {}),
        },
      };
    },
  );
}

interface FunnelQueryResult {
  totalUsers: number;
  steps: FunnelStepAnalytics[];
  breakdown?: Array<{
    key: string;
    value: string;
    total_users: number;
    steps: FunnelStepAnalytics[];
  }>;
}

interface FunnelQueryOptions {
  appIds: string[];
  steps: Array<{ name: string; event_filter: { message?: string; screen_name?: string } }>;
  sinceDate: Date;
  untilDate: Date;
  mode: "closed" | "open";
  dataMode?: string;
  environment?: string;
  appVersion?: string;
  experiment?: string;
  groupBy?: string;
}

async function buildFunnelQuery(
  fastify: FastifyInstance,
  opts: FunnelQueryOptions,
): Promise<FunnelQueryResult> {
  const { appIds, steps, sinceDate, untilDate, mode, dataMode, environment, appVersion, experiment, groupBy } = opts;

  // Build base Drizzle conditions on funnelEvents
  const baseConditions: SQL[] = [
    inArray(funnelEvents.app_id, appIds),
    gte(funnelEvents.timestamp, sinceDate),
    lte(funnelEvents.timestamp, untilDate),
    sql`${funnelEvents.user_id} IS NOT NULL`,
  ];

  const devCondition = dataModeToDrizzle(funnelEvents.is_dev, dataMode as any);
  if (devCondition) baseConditions.push(devCondition);

  if (environment) {
    baseConditions.push(sql`${funnelEvents.environment} = ${environment}`);
  }

  if (appVersion) {
    baseConditions.push(eq(funnelEvents.app_version, appVersion));
  }

  if (experiment) {
    const colonIdx = experiment.indexOf(":");
    if (colonIdx > 0) {
      const expName = experiment.slice(0, colonIdx);
      const expVariant = experiment.slice(colonIdx + 1);
      baseConditions.push(sql`${funnelEvents.experiments}->>${expName} = ${expVariant}`);
    }
  }

  if (groupBy) {
    return buildGroupedFunnelQuery(fastify, steps, baseConditions, mode, groupBy);
  }

  const stepCounts = await computeStepCounts(fastify, steps, baseConditions, mode);
  const stepAnalytics = computeStepAnalytics(steps, stepCounts);

  return {
    totalUsers: stepAnalytics.length > 0 ? stepAnalytics[0].unique_users : 0,
    steps: stepAnalytics,
  };
}

/**
 * Compute user counts for each funnel step. Closed mode runs sequentially
 * (each step depends on the previous). Open mode runs in parallel.
 */
async function computeStepCounts(
  fastify: FastifyInstance,
  steps: Array<{ name: string; event_filter: { message?: string; screen_name?: string } }>,
  baseConditions: SQL[],
  mode: "closed" | "open",
): Promise<number[]> {
  if (mode === "open") {
    // Open: all steps are independent — run in parallel
    const results = await Promise.all(
      steps.map(async (step) => {
        const stepFilter = buildStepFilterSql(step.event_filter);
        const rows = await fastify.db
          .select({ count: sql<number>`COUNT(DISTINCT ${funnelEvents.user_id})::int` })
          .from(funnelEvents)
          .where(and(...baseConditions, stepFilter));
        return rows[0]?.count ?? 0;
      }),
    );
    return results;
  }

  // Closed: sequential, each step filters to users from previous step
  const stepUserSets: Map<string, Date>[] = [];

  for (let i = 0; i < steps.length; i++) {
    const stepFilter = buildStepFilterSql(steps[i].event_filter);
    const conditions = [...baseConditions, stepFilter];

    if (i > 0) {
      const prevUsers = stepUserSets[i - 1];
      if (prevUsers.size === 0) {
        stepUserSets.push(new Map());
        continue;
      }

      const prevUserIds = [...prevUsers.keys()];
      const rows = await fastify.db
        .select({
          user_id: funnelEvents.user_id,
          step_ts: sql<Date>`MIN(${funnelEvents.timestamp})`,
        })
        .from(funnelEvents)
        .where(and(...conditions, inArray(funnelEvents.user_id, prevUserIds)))
        .groupBy(funnelEvents.user_id);

      const userMap = new Map<string, Date>();
      for (const row of rows) {
        if (!row.user_id) continue;
        const prevTs = prevUsers.get(row.user_id);
        if (prevTs && row.step_ts > prevTs) {
          userMap.set(row.user_id, row.step_ts);
        }
      }
      stepUserSets.push(userMap);
    } else {
      // First step
      const rows = await fastify.db
        .select({
          user_id: funnelEvents.user_id,
          step_ts: sql<Date>`MIN(${funnelEvents.timestamp})`,
        })
        .from(funnelEvents)
        .where(and(...conditions))
        .groupBy(funnelEvents.user_id);

      const userMap = new Map<string, Date>();
      for (const row of rows) {
        if (row.user_id) userMap.set(row.user_id, row.step_ts);
      }
      stepUserSets.push(userMap);
    }
  }

  return stepUserSets.map((m) => m.size);
}

async function buildGroupedFunnelQuery(
  fastify: FastifyInstance,
  steps: Array<{ name: string; event_filter: { message?: string; screen_name?: string } }>,
  baseConditions: SQL[],
  mode: "closed" | "open",
  groupBy: string,
): Promise<FunnelQueryResult> {
  let groupExpr: SQL;
  let groupKey: string;

  if (groupBy === "environment") {
    groupExpr = sql`${funnelEvents.environment}::text`;
    groupKey = "environment";
  } else if (groupBy === "app_version") {
    groupExpr = sql`${funnelEvents.app_version}`;
    groupKey = "app_version";
  } else if (groupBy.startsWith("experiment:")) {
    const expName = groupBy.slice("experiment:".length);
    groupExpr = sql`${funnelEvents.experiments}->>${expName}`;
    groupKey = groupBy;
  } else {
    return { totalUsers: 0, steps: [], breakdown: [] };
  }

  // Get distinct group values
  const groupRows = await fastify.db
    .selectDistinct({ grp: sql<string>`${groupExpr}` })
    .from(funnelEvents)
    .where(and(...baseConditions, sql`${groupExpr} IS NOT NULL`));

  const groupValues = groupRows.map((r) => r.grp).filter(Boolean);

  // Run groups in parallel — each group is independent
  const groupResults = await Promise.all(
    groupValues.map(async (groupValue) => {
      const groupConditions = [...baseConditions, sql`${groupExpr} = ${groupValue}`];
      const stepCounts = await computeStepCounts(fastify, steps, groupConditions, mode);
      const groupSteps = computeStepAnalytics(steps, stepCounts);
      return { groupValue, stepCounts, groupSteps };
    }),
  );

  const overallStepCounts: number[] = new Array(steps.length).fill(0);
  const breakdown: FunnelQueryResult["breakdown"] = [];

  for (const { groupValue, stepCounts, groupSteps } of groupResults) {
    const groupTotalUsers = groupSteps.length > 0 ? groupSteps[0].unique_users : 0;
    breakdown.push({
      key: groupKey,
      value: groupValue,
      total_users: groupTotalUsers,
      steps: groupSteps,
    });
    stepCounts.forEach((c, i) => { overallStepCounts[i] += c; });
  }

  const overallSteps = computeStepAnalytics(steps, overallStepCounts);

  return {
    totalUsers: overallSteps.length > 0 ? overallSteps[0].unique_users : 0,
    steps: overallSteps,
    breakdown,
  };
}

function buildStepFilterSql(filter: { message?: string; screen_name?: string }): SQL {
  const conditions: SQL[] = [];
  if (filter.message) {
    conditions.push(sql`${funnelEvents.message} = ${filter.message}`);
  }
  if (filter.screen_name) {
    conditions.push(sql`${funnelEvents.screen_name} = ${filter.screen_name}`);
  }
  return conditions.length > 0 ? and(...conditions)! : sql`TRUE`;
}

function computeStepAnalytics(
  steps: Array<{ name: string; event_filter: { message?: string; screen_name?: string } }>,
  stepCounts: number[],
): FunnelStepAnalytics[] {
  const analytics: FunnelStepAnalytics[] = [];
  const firstStepUsers = stepCounts[0] || 0;

  for (let i = 0; i < steps.length; i++) {
    const users = stepCounts[i];
    const prevUsers = i > 0 ? analytics[i - 1].unique_users : users;
    const dropOff = i > 0 ? prevUsers - users : 0;

    analytics.push({
      step_index: i,
      step_name: steps[i].name,
      unique_users: users,
      percentage: firstStepUsers > 0 ? Math.round((users / firstStepUsers) * 1000) / 10 : 0,
      drop_off_count: dropOff,
      drop_off_percentage: prevUsers > 0 && i > 0 ? Math.round((dropOff / prevUsers) * 1000) / 10 : 0,
    });
  }

  return analytics;
}
