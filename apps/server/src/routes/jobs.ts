import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, desc, lt, or, isNull, isNotNull } from "drizzle-orm";
import { jobRuns } from "@owlmetry/db";
import { JOB_TYPES, JOB_TYPE_META, parseTimeParam } from "@owlmetry/shared";
import type { JobRunsQueryParams, JobType } from "@owlmetry/shared";
import { requirePermission, assertTeamRole, hasTeamAccess, getAuthTeamIds } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { logAuditEvent } from "../utils/audit.js";
import { serializeJobRun } from "../utils/serialize.js";
import { normalizeLimit } from "../utils/pagination.js";

export async function jobsRoutes(app: FastifyInstance) {
  // List team job runs
  app.get<{ Params: { teamId: string }; Querystring: JobRunsQueryParams }>(
    "/jobs",
    { preHandler: requirePermission("jobs:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;
      const { job_type, status, project_id, since, until, cursor, limit: limitStr } = request.query;

      if (!hasTeamAccess(auth, teamId)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      if (auth.type === "user") {
        const roleError = assertTeamRole(auth, teamId, "admin");
        if (roleError) return reply.code(403).send({ error: roleError });
      }

      const limit = normalizeLimit(limitStr);
      const conditions = [eq(jobRuns.team_id, teamId)];

      if (job_type) conditions.push(eq(jobRuns.job_type, job_type));
      if (status) conditions.push(eq(jobRuns.status, status as any));
      if (project_id) conditions.push(eq(jobRuns.project_id, project_id));
      if (since) conditions.push(gte(jobRuns.created_at, parseTimeParam(since)));
      if (until) conditions.push(lte(jobRuns.created_at, parseTimeParam(until)));

      if (cursor) {
        const [cursorTs, cursorId] = cursor.split("|");
        if (cursorTs && cursorId) {
          const cursorDate = new Date(cursorTs);
          conditions.push(
            or(
              lt(jobRuns.created_at, cursorDate),
              and(eq(jobRuns.created_at, cursorDate), lt(jobRuns.id, cursorId)),
            )!,
          );
        }
      }

      const rows = await app.db
        .select()
        .from(jobRuns)
        .where(and(...conditions))
        .orderBy(desc(jobRuns.created_at), desc(jobRuns.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = pageRows[pageRows.length - 1];
      const nextCursor =
        hasMore && lastRow
          ? `${lastRow.created_at.toISOString()}|${lastRow.id}`
          : null;

      return {
        job_runs: pageRows.map(serializeJobRun),
        cursor: nextCursor,
        has_more: hasMore,
      };
    },
  );

  // Trigger a team job
  app.post<{
    Params: { teamId: string };
    Body: { job_type: string; project_id?: string; params?: Record<string, unknown>; notify?: boolean };
  }>(
    "/jobs/trigger",
    { preHandler: requirePermission("jobs:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;
      const { job_type, project_id, params, notify } = request.body;

      if (!hasTeamAccess(auth, teamId)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      if (auth.type === "user") {
        const roleError = assertTeamRole(auth, teamId, "admin");
        if (roleError) return reply.code(403).send({ error: roleError });
      }

      if (!job_type || !JOB_TYPES.includes(job_type as JobType)) {
        return reply.code(400).send({ error: `Invalid job_type. Must be one of: ${JOB_TYPES.join(", ")}` });
      }

      const meta = JOB_TYPE_META[job_type as JobType];
      if (meta.scope === "system") {
        return reply.code(400).send({ error: `Cannot trigger system job "${job_type}" via API` });
      }

      if (meta.scope === "project" && !project_id) {
        return reply.code(400).send({ error: "project_id is required for project-scoped jobs" });
      }

      if (project_id) {
        const project = await resolveProject(app, project_id, auth, reply);
        if (!project) return;
      }

      // Check for duplicate running/pending job
      const duplicateConditions = [
        eq(jobRuns.job_type, job_type),
        or(eq(jobRuns.status, "pending"), eq(jobRuns.status, "running"))!,
      ];
      if (project_id) {
        duplicateConditions.push(eq(jobRuns.project_id, project_id));
      }

      const [existing] = await app.db
        .select()
        .from(jobRuns)
        .where(and(...duplicateConditions))
        .limit(1);

      if (existing) {
        return reply.code(409).send({
          error: "A job of this type is already running or pending",
          existing_run: serializeJobRun(existing),
        });
      }

      const triggeredBy =
        auth.type === "user"
          ? `manual:user:${auth.user_id}`
          : `manual:api_key:${auth.key_id}`;

      const run = await app.jobRunner.trigger(job_type, {
        triggeredBy,
        teamId,
        projectId: project_id,
        params,
        notify: notify ?? false,
      });

      // Fetch the full row for the response
      const [created] = await app.db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.id, run.id))
        .limit(1);

      logAuditEvent(app.db, auth, {
        team_id: teamId,
        action: "create",
        resource_type: "job_run",
        resource_id: run.id,
        metadata: { job_type, project_id },
      });

      return reply.code(201).send({ job_run: serializeJobRun(created) });
    },
  );
}

export async function jobsByIdRoutes(app: FastifyInstance) {
  // Get single job run
  app.get<{ Params: { runId: string } }>(
    "/jobs/:runId",
    { preHandler: requirePermission("jobs:read") },
    async (request, reply) => {
      const { runId } = request.params;

      const [run] = await app.db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.id, runId))
        .limit(1);

      if (!run) {
        return reply.code(404).send({ error: "Job run not found" });
      }

      // Access check: team jobs require team access
      if (run.team_id && !hasTeamAccess(request.auth, run.team_id)) {
        return reply.code(404).send({ error: "Job run not found" });
      }

      // System jobs (null team_id) are not accessible via this route
      if (!run.team_id) {
        return reply.code(404).send({ error: "Job run not found" });
      }

      return { job_run: serializeJobRun(run) };
    },
  );

  // Cancel a running job
  app.post<{ Params: { runId: string } }>(
    "/jobs/:runId/cancel",
    { preHandler: requirePermission("jobs:write") },
    async (request, reply) => {
      const { runId } = request.params;

      const [run] = await app.db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.id, runId))
        .limit(1);

      if (!run) {
        return reply.code(404).send({ error: "Job run not found" });
      }

      if (run.team_id && !hasTeamAccess(request.auth, run.team_id)) {
        return reply.code(404).send({ error: "Job run not found" });
      }

      if (run.status !== "running") {
        return reply.code(400).send({ error: `Cannot cancel a job with status "${run.status}"` });
      }

      const cancelled = app.jobRunner.cancel(runId);
      if (!cancelled) {
        return reply.code(400).send({ error: "Job is not currently running on this server" });
      }

      return { cancelled: true };
    },
  );
}
