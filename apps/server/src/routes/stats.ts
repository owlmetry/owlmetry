import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  apps,
  projects,
  funnelDefinitions,
  eventsDaily,
  eventsHourly,
  metricEventsDaily,
  metricEventsHourly,
  funnelEventsDaily,
  funnelEventsHourly,
  questionnaireResponsesDaily,
  questionnaireResponsesHourly,
} from "@owlmetry/db";
import {
  STATS_KINDS,
  STATS_GRAINS,
  STATS_MAX_WINDOW_DAYS,
  STATS_MAX_WINDOW_HOURS,
  type StatsKind,
  type StatsGrain,
  type StatsBucketedQueryParams,
  type StatsBucketedResponse,
  type StatsBucketedPoint,
} from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { dataModeToDrizzle } from "../utils/data-mode.js";
import { resolveProject } from "../utils/project.js";

interface ResolvedWindow {
  start: Date;
  endInclusive: Date;
}

/**
 * Compute the inclusive bucket-start range for a query.
 *
 * - `from` + `to`: ISO 8601 dates (for daily) or timestamps (for hourly).
 *   Both must be set; otherwise trailing window applies.
 * - `days` or `hours`: trailing window length (defaults 30 / 24). Capped at
 *   STATS_MAX_WINDOW_DAYS / STATS_MAX_WINDOW_HOURS to keep response payloads small.
 * - `excluding_current` (default true): the in-progress bucket is dropped, so
 *   the trailing window ends at "yesterday" (daily) or "the start of the
 *   previous fully-completed hour" (hourly). The card sparkline always passes
 *   this implicitly so a partial bucket can't render as a dip.
 */
function resolveWindow(
  grain: StatsGrain,
  query: StatsBucketedQueryParams,
): ResolvedWindow {
  const now = new Date();
  const excludeCurrent = query.excluding_current !== false;

  if (query.from && query.to) {
    const start = parseBucketStart(grain, query.from);
    const endInclusive = parseBucketStart(grain, query.to);
    if (!start || !endInclusive) {
      throw new Error("Invalid from/to format");
    }
    return { start, endInclusive };
  }

  const currentBucket = truncate(grain, now);
  const endInclusive = excludeCurrent ? addBuckets(grain, currentBucket, -1) : currentBucket;
  const rawCount =
    grain === "daily"
      ? Math.max(1, Math.min(STATS_MAX_WINDOW_DAYS, query.days ?? 30))
      : Math.max(1, Math.min(STATS_MAX_WINDOW_HOURS, query.hours ?? 24));
  const start = addBuckets(grain, endInclusive, -(rawCount - 1));
  return { start, endInclusive };
}

function parseBucketStart(grain: StatsGrain, value: string): Date | null {
  if (grain === "daily") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) {
      // Fall through: allow a full ISO timestamp and truncate.
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      return truncate("daily", d);
    }
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return truncate("hourly", d);
}

function truncate(grain: StatsGrain, d: Date): Date {
  if (grain === "daily") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
  ));
}

function addBuckets(grain: StatsGrain, d: Date, n: number): Date {
  const r = new Date(d);
  if (grain === "daily") r.setUTCDate(r.getUTCDate() + n);
  else r.setUTCHours(r.getUTCHours() + n);
  return r;
}

/** YYYY-MM-DD for daily, ISO 8601 for hourly. */
function formatBucket(grain: StatsGrain, d: Date): string {
  return grain === "daily" ? d.toISOString().slice(0, 10) : d.toISOString();
}

/** Iterate every bucket from start to endInclusive. */
function* bucketRange(grain: StatsGrain, start: Date, endInclusive: Date): Generator<Date> {
  let d = new Date(start);
  while (d.getTime() <= endInclusive.getTime()) {
    yield new Date(d);
    d = addBuckets(grain, d, 1);
  }
}

function tableForKind(kind: StatsKind, grain: StatsGrain) {
  if (kind === "events" || kind === "users" || kind === "sessions") {
    return grain === "daily" ? eventsDaily : eventsHourly;
  }
  if (kind === "metric_completions") {
    return grain === "daily" ? metricEventsDaily : metricEventsHourly;
  }
  if (kind === "funnel_completions") {
    return grain === "daily" ? funnelEventsDaily : funnelEventsHourly;
  }
  return grain === "daily" ? questionnaireResponsesDaily : questionnaireResponsesHourly;
}

/** Returns the column expression that maps to the response `value` field. */
function valueExpressionForKind(kind: StatsKind, table: any): SQL<string> {
  if (kind === "events") return sql<string>`SUM((${table.event_count})::bigint)::bigint`;
  if (kind === "users") return sql<string>`SUM((${table.unique_users})::bigint)::bigint`;
  if (kind === "sessions") return sql<string>`SUM((${table.unique_sessions})::bigint)::bigint`;
  if (kind === "metric_completions") return sql<string>`SUM((${table.count})::bigint)::bigint`;
  if (kind === "funnel_completions") return sql<string>`SUM((${table.count})::bigint)::bigint`;
  return sql<string>`SUM((${table.submitted_count})::bigint)::bigint`;
}

interface BucketedScope {
  teamIds: string[];
  /** When set, narrow to this single project (project-scoped routes). */
  projectId?: string;
  appId?: string | null;
  /** Resolved terminal step names per project — only set for funnel_completions. */
  funnelTerminalSteps?: Map<string, string[]>;
}

/**
 * Core query. Returns one row per bucket (with zero-padding) for the given
 * scope + kind + grain. Uses the rollup row (app_id IS NULL) when no app_id
 * filter is provided so reads hit a single row per (team, project, is_dev,
 * bucket), never a SUM across apps.
 */
async function fetchBucketedSeries(
  app: FastifyInstance,
  kind: StatsKind,
  grain: StatsGrain,
  bucketCol: "day" | "hour",
  window: ResolvedWindow,
  scope: BucketedScope,
  dataMode: StatsBucketedQueryParams["data_mode"],
  slug: string | undefined,
): Promise<StatsBucketedPoint[]> {
  const table = tableForKind(kind, grain) as any;
  const bucketField = table[bucketCol];
  // postgres-js v3 doesn't always auto-serialize Date when bound via Drizzle's
  // sql template into a `date` (not timestamptz) column comparison — pass ISO
  // strings explicitly and cast to the target type on the SQL side. Hourly
  // tables use timestamptz; daily tables use date.
  const startBind = bucketCol === "day"
    ? window.start.toISOString().slice(0, 10)
    : window.start.toISOString();
  const endBind = bucketCol === "day"
    ? window.endInclusive.toISOString().slice(0, 10)
    : window.endInclusive.toISOString();
  const conditions = [
    sql`${bucketField} >= ${startBind}::${sql.raw(bucketCol === "day" ? "date" : "timestamptz")}`,
    sql`${bucketField} <= ${endBind}::${sql.raw(bucketCol === "day" ? "date" : "timestamptz")}`,
  ];

  if (scope.teamIds.length === 0) {
    return zeroPad(grain, window);
  }
  conditions.push(inArray(table.team_id, scope.teamIds));
  if (scope.projectId) conditions.push(eq(table.project_id, scope.projectId));

  if (scope.appId) {
    conditions.push(eq(table.app_id, scope.appId));
  } else {
    conditions.push(isNull(table.app_id));
  }

  const devCondition = dataModeToDrizzle(table.is_dev, dataMode);
  if (devCondition) conditions.push(devCondition);

  // Kind-specific filters layered on top.
  if (kind === "metric_completions") {
    conditions.push(eq(table.phase, "complete"));
    if (slug) conditions.push(eq(table.metric_slug, slug));
  } else if (kind === "funnel_completions") {
    // Terminal steps are already narrowed by slug at the route layer in
    // resolveFunnelTerminalSteps — we just filter to whatever the route gave us.
    const terminalByProject = scope.funnelTerminalSteps ?? new Map<string, string[]>();
    const allTerminal = new Set<string>();
    for (const steps of terminalByProject.values()) for (const s of steps) allTerminal.add(s);
    if (allTerminal.size === 0) {
      // No funnel definitions in scope ⇒ no completions to plot.
      return zeroPad(grain, window);
    }
    conditions.push(inArray(table.step_name, Array.from(allTerminal)));
  }

  const rows = (await app.db
    .select({
      bucket: sql<Date>`${bucketField}`,
      value: valueExpressionForKind(kind, table),
    })
    .from(table)
    .where(and(...conditions))
    .groupBy(bucketField)
    .orderBy(bucketField)) as Array<{ bucket: Date; value: string | number | bigint | null }>;

  // Build a map keyed by bucket ISO so we can zero-pad.
  const byBucket = new Map<string, number>();
  for (const row of rows) {
    const d = row.bucket instanceof Date ? row.bucket : new Date(row.bucket as unknown as string);
    const value = typeof row.value === "bigint" ? Number(row.value) : Number(row.value ?? 0);
    byBucket.set(formatBucket(grain, d), value);
  }

  const out: StatsBucketedPoint[] = [];
  for (const d of bucketRange(grain, window.start, window.endInclusive)) {
    const key = formatBucket(grain, d);
    out.push({ bucket: key, value: byBucket.get(key) ?? 0 });
  }
  return out;
}

function zeroPad(grain: StatsGrain, window: ResolvedWindow): StatsBucketedPoint[] {
  const out: StatsBucketedPoint[] = [];
  for (const d of bucketRange(grain, window.start, window.endInclusive)) {
    out.push({ bucket: formatBucket(grain, d), value: 0 });
  }
  return out;
}

function permissionForKind(kind: StatsKind) {
  if (kind === "metric_completions") return "metrics:read";
  if (kind === "funnel_completions") return "funnels:read";
  if (kind === "questionnaire_responses") return "questionnaires:read";
  return "events:read"; // events / users / sessions
}

function parseKindAndGrain(rawKind: string, rawGrain: string): { kind: StatsKind; grain: StatsGrain } | null {
  if (!(STATS_KINDS as readonly string[]).includes(rawKind)) return null;
  if (!(STATS_GRAINS as readonly string[]).includes(rawGrain)) return null;
  return { kind: rawKind as StatsKind, grain: rawGrain as StatsGrain };
}

/** For funnel_completions: which step names count as "completion" per project. */
async function resolveFunnelTerminalSteps(
  app: FastifyInstance,
  projectIds: string[],
  slug?: string,
): Promise<Map<string, string[]>> {
  if (projectIds.length === 0) return new Map();
  const conditions = [
    inArray(funnelDefinitions.project_id, projectIds),
    isNull(funnelDefinitions.deleted_at),
  ];
  if (slug) conditions.push(eq(funnelDefinitions.slug, slug));

  const rows = await app.db
    .select({
      project_id: funnelDefinitions.project_id,
      steps: funnelDefinitions.steps,
    })
    .from(funnelDefinitions)
    .where(and(...conditions));

  const out = new Map<string, string[]>();
  for (const r of rows) {
    const steps = (r.steps as Array<{ name: string }> | null) ?? [];
    if (steps.length === 0) continue;
    const terminal = steps[steps.length - 1].name;
    const arr = out.get(r.project_id) ?? [];
    arr.push(terminal);
    out.set(r.project_id, arr);
  }
  return out;
}

/** Routes nested under /v1/projects/:projectId */
export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: { projectId: string; kind: string; grain: string };
    Querystring: StatsBucketedQueryParams;
    Reply: StatsBucketedResponse | { error: string };
  }>(
    "/stats/:kind/:grain",
    async (request, reply) => {
      const { projectId, kind: rawKind, grain: rawGrain } = request.params;
      const parsed = parseKindAndGrain(rawKind, rawGrain);
      if (!parsed) {
        reply.code(400).send({ error: `Invalid kind/grain. Valid kinds: ${STATS_KINDS.join(", ")}; grains: ${STATS_GRAINS.join(", ")}` });
        return;
      }
      const { kind, grain } = parsed;

      // Late auth: permission depends on kind. We can't put this in preHandler
      // because preHandler runs before params parse and kind isn't validated yet.
      const permCheck = await runPermission(request, reply, permissionForKind(kind));
      if (permCheck) return;

      const project = await resolveProject(fastify, projectId, request.auth, reply);
      if (!project) return;

      let window: ResolvedWindow;
      try {
        window = resolveWindow(grain, request.query);
      } catch (e) {
        reply.code(400).send({ error: (e as Error).message });
        return;
      }
      const bucketCol = grain === "daily" ? "day" : "hour";

      let funnelTerminalSteps: Map<string, string[]> | undefined;
      if (kind === "funnel_completions") {
        funnelTerminalSteps = await resolveFunnelTerminalSteps(
          fastify,
          [projectId],
          request.query.slug,
        );
      }

      const data = await fetchBucketedSeries(
        fastify,
        kind,
        grain,
        bucketCol,
        window,
        {
          teamIds: [project.team_id],
          projectId,
          appId: request.query.app_id ?? null,
          funnelTerminalSteps,
        },
        request.query.data_mode,
        request.query.slug,
      );

      reply.send({
        kind,
        grain,
        from: formatBucket(grain, window.start),
        to: formatBucket(grain, window.endInclusive),
        data,
      });
    },
  );
}

/** Routes registered under /v1 (team-scoped). */
export async function teamStatsRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: { kind: string; grain: string };
    Querystring: StatsBucketedQueryParams;
    Reply: StatsBucketedResponse | { error: string };
  }>(
    "/stats/:kind/:grain",
    async (request, reply) => {
      const { kind: rawKind, grain: rawGrain } = request.params;
      const parsed = parseKindAndGrain(rawKind, rawGrain);
      if (!parsed) {
        reply.code(400).send({ error: `Invalid kind/grain` });
        return;
      }
      const { kind, grain } = parsed;

      const permCheck = await runPermission(request, reply, permissionForKind(kind));
      if (permCheck) return;

      const allTeamIds = getAuthTeamIds(request.auth);
      const requestedTeam = request.query.team_id;
      const teamIds = requestedTeam
        ? allTeamIds.includes(requestedTeam) ? [requestedTeam] : []
        : allTeamIds;

      let window: ResolvedWindow;
      try {
        window = resolveWindow(grain, request.query);
      } catch (e) {
        reply.code(400).send({ error: (e as Error).message });
        return;
      }
      const bucketCol = grain === "daily" ? "day" : "hour";

      let funnelTerminalSteps: Map<string, string[]> | undefined;
      if (kind === "funnel_completions" && teamIds.length > 0) {
        const teamProjects = await fastify.db
          .select({ id: projects.id })
          .from(projects)
          .where(and(inArray(projects.team_id, teamIds), isNull(projects.deleted_at)));
        funnelTerminalSteps = await resolveFunnelTerminalSteps(
          fastify,
          teamProjects.map((p) => p.id),
          request.query.slug,
        );
      }

      // app_id only resolvable when team membership is verified.
      let appId: string | null = null;
      if (request.query.app_id && teamIds.length > 0) {
        const [appRow] = await fastify.db
          .select({ id: apps.id })
          .from(apps)
          .where(
            and(
              eq(apps.id, request.query.app_id),
              inArray(apps.team_id, teamIds),
              isNull(apps.deleted_at),
            ),
          )
          .limit(1);
        if (!appRow) {
          reply.code(404).send({ error: "App not found" });
          return;
        }
        appId = appRow.id;
      }

      const data = await fetchBucketedSeries(
        fastify,
        kind,
        grain,
        bucketCol,
        window,
        {
          teamIds,
          appId,
          funnelTerminalSteps,
        },
        request.query.data_mode,
        request.query.slug,
      );

      reply.send({
        kind,
        grain,
        from: formatBucket(grain, window.start),
        to: formatBucket(grain, window.endInclusive),
        data,
      });
    },
  );
}

/**
 * Run the permission check inline so dynamic kind → permission mapping works.
 * Returns true if the response was already sent (caller should bail).
 */
async function runPermission(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  perm: ReturnType<typeof permissionForKind>,
): Promise<boolean> {
  await requirePermission(perm)(request, reply);
  return reply.sent;
}
