import { eq, and, isNull } from "drizzle-orm";
import { projectIntegrations } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import type { AuthContext } from "../types.js";

/**
 * Lookup the active (enabled + not soft-deleted) integration for a project
 * and provider, or `null` if there isn't one. Shared across route handlers,
 * jobs, and webhook handlers so the "is this integration usable" predicate
 * lives in one place.
 */
export async function findActiveIntegration(
  db: Db,
  projectId: string,
  provider: string,
) {
  const [integration] = await db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.project_id, projectId),
        eq(projectIntegrations.provider, provider),
        isNull(projectIntegrations.deleted_at),
        eq(projectIntegrations.enabled, true),
      ),
    )
    .limit(1);
  return integration ?? null;
}

/**
 * Canonical "who kicked off this job" string for manual triggers — either a
 * user JWT or an agent API key. Matches the `manual:user:` / `manual:api_key:`
 * convention pg-boss stores on the row so downstream audit tooling can parse
 * it uniformly.
 */
export function formatManualTriggeredBy(auth: AuthContext): string {
  return auth.type === "user"
    ? `manual:user:${auth.user_id}`
    : `manual:api_key:${auth.key_id}`;
}
