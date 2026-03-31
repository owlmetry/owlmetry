import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { projects, apps } from "@owlmetry/db";
import { getAuthTeamIds } from "../middleware/auth.js";
import type { AuthContext } from "../types.js";

/**
 * Verify project exists and the authenticated user/key has team access.
 * Returns the project row or sends 404 and returns null.
 */
export async function resolveProject(
  fastify: FastifyInstance,
  projectId: string,
  auth: AuthContext,
  reply: FastifyReply,
): Promise<{ id: string; team_id: string } | null> {
  const teamIds = getAuthTeamIds(auth);
  const [project] = await fastify.db
    .select({ id: projects.id, team_id: projects.team_id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        inArray(projects.team_id, teamIds),
        isNull(projects.deleted_at),
      ),
    )
    .limit(1);

  if (!project) {
    reply.code(404).send({ error: "Project not found" });
    return null;
  }
  return project;
}

/** Look up the project_id for an app. Returns null if app not found. */
export async function resolveProjectIdFromApp(
  fastify: FastifyInstance,
  appId: string,
): Promise<string | null> {
  const [row] = await fastify.db
    .select({ project_id: apps.project_id })
    .from(apps)
    .where(and(eq(apps.id, appId), isNull(apps.deleted_at)))
    .limit(1);
  return row?.project_id ?? null;
}

/** Resolve project access and return app IDs for the project. */
export async function resolveProjectAppIds(
  fastify: FastifyInstance,
  projectId: string,
  auth: AuthContext,
  reply: FastifyReply,
): Promise<string[] | null> {
  const project = await resolveProject(fastify, projectId, auth, reply);
  if (!project) return null;

  const projectApps = await fastify.db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.project_id, projectId), isNull(apps.deleted_at)));

  return projectApps.map((a) => a.id);
}
