import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, isNotNull, asc } from "drizzle-orm";
import { projects, apps, apiKeys, metricDefinitions, funnelDefinitions } from "@owlmetry/db";
import type { CreateProjectRequest, UpdateProjectRequest } from "@owlmetry/shared";
import {
  SLUG_REGEX,
  PG_UNIQUE_VIOLATION,
  DEFAULT_RETENTION_DAYS_EVENTS,
  DEFAULT_RETENTION_DAYS_METRICS,
  DEFAULT_RETENTION_DAYS_FUNNELS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  ISSUE_ALERT_FREQUENCIES,
  isValidProjectColor,
} from "@owlmetry/shared";
import { serializeApp, getClientSecretMap } from "../utils/serialize.js";
import { requirePermission, getAuthTeamIds, hasTeamAccess, assertTeamRole } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { pickUnusedProjectColor } from "../utils/project-color.js";

function serializeProject(p: typeof projects.$inferSelect) {
  return {
    id: p.id,
    team_id: p.team_id,
    name: p.name,
    slug: p.slug,
    color: p.color,
    retention_days_events: p.retention_days_events,
    retention_days_metrics: p.retention_days_metrics,
    retention_days_funnels: p.retention_days_funnels,
    effective_retention_days_events: p.retention_days_events ?? DEFAULT_RETENTION_DAYS_EVENTS,
    effective_retention_days_metrics: p.retention_days_metrics ?? DEFAULT_RETENTION_DAYS_METRICS,
    effective_retention_days_funnels: p.retention_days_funnels ?? DEFAULT_RETENTION_DAYS_FUNNELS,
    issue_alert_frequency: p.issue_alert_frequency,
    effective_issue_alert_frequency: p.issue_alert_frequency ?? "daily",
    created_at: p.created_at.toISOString(),
  };
}

function validateRetentionDays(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `${field} must be an integer or null`;
  }
  if (value < MIN_RETENTION_DAYS || value > MAX_RETENTION_DAYS) {
    return `${field} must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`;
  }
  return null;
}

export async function projectsRoutes(app: FastifyInstance) {
  // List projects for the authenticated user's teams
  app.get<{ Querystring: { team_id?: string } }>(
    "/projects",
    { preHandler: requirePermission("projects:read") },
    async (request, reply) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      const { team_id } = request.query;

      // If team_id is specified, validate access and scope to that team
      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { projects: [] };
      }

      const rows = await app.db
        .select()
        .from(projects)
        .where(and(inArray(projects.team_id, teamIds), isNull(projects.deleted_at)))
        .orderBy(asc(projects.created_at), asc(projects.id));

      return {
        projects: rows.map(serializeProject),
      };
    }
  );

  // Get single project with its apps
  app.get<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;

      const [project] = await app.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth)),
            isNull(projects.deleted_at)
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const projectApps = await app.db
        .select()
        .from(apps)
        .where(and(eq(apps.project_id, id), isNull(apps.deleted_at)));

      const secretMap = await getClientSecretMap(app.db, projectApps.map(a => a.id));

      return {
        ...serializeProject(project),
        apps: projectApps.map(a => serializeApp({ ...a, client_secret: secretMap.get(a.id) ?? null })),
      };
    }
  );

  // Create project
  app.post<{ Body: CreateProjectRequest }>(
    "/projects",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { team_id, name, slug, retention_days_events, retention_days_metrics, retention_days_funnels } = request.body;

      if (!team_id || !name || !slug) {
        return reply
          .code(400)
          .send({ error: "team_id, name, and slug are required" });
      }

      if (!SLUG_REGEX.test(slug)) {
        return reply
          .code(400)
          .send({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
      }

      for (const [field, value] of Object.entries({ retention_days_events, retention_days_metrics, retention_days_funnels })) {
        const err = validateRetentionDays(value, field);
        if (err) return reply.code(400).send({ error: err });
      }

      if (!hasTeamAccess(auth, team_id)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      const roleError = assertTeamRole(auth, team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      try {
        // Clear any soft-deleted project with the same slug so it can be reused
        await app.db
          .delete(projects)
          .where(
            and(
              eq(projects.team_id, team_id),
              eq(projects.slug, slug),
              isNotNull(projects.deleted_at)
            )
          );

        const color = await pickUnusedProjectColor(app.db, team_id);

        const [created] = await app.db
          .insert(projects)
          .values({
            team_id,
            name,
            slug,
            color,
            retention_days_events: retention_days_events ?? null,
            retention_days_metrics: retention_days_metrics ?? null,
            retention_days_funnels: retention_days_funnels ?? null,
          })
          .returning();

        logAuditEvent(app.db, auth, {
          team_id,
          action: "create",
          resource_type: "project",
          resource_id: created.id,
          metadata: { name, slug },
        });

        return reply.code(201).send(serializeProject(created));
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          return reply
            .code(409)
            .send({ error: "A project with this slug already exists in your team" });
        }
        throw err;
      }
    }
  );

  // Update project
  app.patch<{ Params: { id: string }; Body: UpdateProjectRequest }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;
      const { name, color, retention_days_events, retention_days_metrics, retention_days_funnels, issue_alert_frequency } = request.body;

      const hasRetention = retention_days_events !== undefined || retention_days_metrics !== undefined || retention_days_funnels !== undefined;
      if (!name && color === undefined && !hasRetention && issue_alert_frequency === undefined) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      if (color !== undefined && !isValidProjectColor(color)) {
        return reply.code(400).send({ error: "color must be a valid hex code in #RRGGBB format" });
      }

      for (const [field, value] of Object.entries({ retention_days_events, retention_days_metrics, retention_days_funnels })) {
        const err = validateRetentionDays(value, field);
        if (err) return reply.code(400).send({ error: err });
      }

      if (issue_alert_frequency !== undefined && !ISSUE_ALERT_FREQUENCIES.includes(issue_alert_frequency)) {
        return reply.code(400).send({ error: `issue_alert_frequency must be one of: ${ISSUE_ALERT_FREQUENCIES.join(", ")}` });
      }

      const [project] = await app.db
        .select({
          id: projects.id,
          team_id: projects.team_id,
          name: projects.name,
          color: projects.color,
          retention_days_events: projects.retention_days_events,
          retention_days_metrics: projects.retention_days_metrics,
          retention_days_funnels: projects.retention_days_funnels,
          issue_alert_frequency: projects.issue_alert_frequency,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth)),
            isNull(projects.deleted_at)
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const updateRoleError = assertTeamRole(auth, project.team_id, "admin");
      if (updateRoleError) {
        return reply.code(403).send({ error: updateRoleError });
      }

      const setFields: Record<string, unknown> = {};
      const changes: Record<string, { before: unknown; after: unknown }> = {};

      if (name !== undefined) {
        setFields.name = name;
        changes.name = { before: project.name, after: name };
      }
      if (color !== undefined) {
        setFields.color = color;
        changes.color = { before: project.color, after: color };
      }
      if (retention_days_events !== undefined) {
        setFields.retention_days_events = retention_days_events;
        changes.retention_days_events = { before: project.retention_days_events, after: retention_days_events };
      }
      if (retention_days_metrics !== undefined) {
        setFields.retention_days_metrics = retention_days_metrics;
        changes.retention_days_metrics = { before: project.retention_days_metrics, after: retention_days_metrics };
      }
      if (retention_days_funnels !== undefined) {
        setFields.retention_days_funnels = retention_days_funnels;
        changes.retention_days_funnels = { before: project.retention_days_funnels, after: retention_days_funnels };
      }
      if (issue_alert_frequency !== undefined) {
        setFields.issue_alert_frequency = issue_alert_frequency;
        changes.issue_alert_frequency = { before: project.issue_alert_frequency, after: issue_alert_frequency };
      }

      const [updated] = await app.db
        .update(projects)
        .set(setFields)
        .where(eq(projects.id, id))
        .returning();

      logAuditEvent(app.db, auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "project",
        resource_id: id,
        changes,
      });

      return serializeProject(updated);
    }
  );

  // Delete project (soft delete)
  app.delete<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete projects" });
      }

      const { id } = request.params;

      const [project] = await app.db
        .select({ id: projects.id, team_id: projects.team_id })
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth)),
            isNull(projects.deleted_at)
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const deleteRoleError = assertTeamRole(auth, project.team_id, "admin");
      if (deleteRoleError) {
        return reply.code(403).send({ error: deleteRoleError });
      }

      const now = new Date();

      // Find app IDs for cascading to api_keys
      const projectApps = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.project_id, id), isNull(apps.deleted_at)));
      const appIds = projectApps.map((a) => a.id);

      // Soft-delete the project, its apps, their api_keys, and definitions
      await Promise.all([
        app.db
          .update(apps)
          .set({ deleted_at: now })
          .where(and(eq(apps.project_id, id), isNull(apps.deleted_at))),
        app.db
          .update(projects)
          .set({ deleted_at: now })
          .where(eq(projects.id, id)),
        app.db
          .update(metricDefinitions)
          .set({ deleted_at: now })
          .where(and(eq(metricDefinitions.project_id, id), isNull(metricDefinitions.deleted_at))),
        app.db
          .update(funnelDefinitions)
          .set({ deleted_at: now })
          .where(and(eq(funnelDefinitions.project_id, id), isNull(funnelDefinitions.deleted_at))),
        ...(appIds.length > 0
          ? [app.db
              .update(apiKeys)
              .set({ deleted_at: now })
              .where(and(inArray(apiKeys.app_id, appIds), isNull(apiKeys.deleted_at)))]
          : []),
      ]);

      logAuditEvent(app.db, auth, {
        team_id: project.team_id,
        action: "delete",
        resource_type: "project",
        resource_id: id,
      });

      return { deleted: true };
    }
  );
}
