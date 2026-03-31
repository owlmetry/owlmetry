import type postgres from "postgres";

const CLEANUP_CUTOFF_DAYS = 7;

export interface CleanupResult {
  teams: number;
  projects: number;
  apps: number;
  apiKeys: number;
  metricDefinitions: number;
  funnelDefinitions: number;
  events: number;
  metricEvents: number;
  funnelEvents: number;
  appUsers: number;
  auditLogs: number;
  teamMembers: number;
  teamInvitations: number;
}

/**
 * Hard-deletes resources that were soft-deleted more than 7 days ago,
 * including their orphaned events and related data.
 *
 * Order respects FK constraints — children are deleted before parents.
 */
export async function cleanupSoftDeletedResources(client: postgres.Sql): Promise<CleanupResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CLEANUP_CUTOFF_DAYS);

  const result: CleanupResult = {
    teams: 0,
    projects: 0,
    apps: 0,
    apiKeys: 0,
    metricDefinitions: 0,
    funnelDefinitions: 0,
    events: 0,
    metricEvents: 0,
    funnelEvents: 0,
    appUsers: 0,
    auditLogs: 0,
    teamMembers: 0,
    teamInvitations: 0,
  };

  // Step 1: Ensure cascade consistency — if a team/project is past cutoff
  // but children weren't soft-deleted (edge case), soft-delete them now
  const expiredTeams = await client`
    SELECT id FROM teams WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const expiredTeamIds = expiredTeams.map((r) => r.id);

  if (expiredTeamIds.length > 0) {
    await client`
      UPDATE projects SET deleted_at = COALESCE(deleted_at, NOW())
      WHERE team_id = ANY(${expiredTeamIds}) AND deleted_at IS NULL
    `;
    await client`
      UPDATE apps SET deleted_at = COALESCE(deleted_at, NOW())
      WHERE team_id = ANY(${expiredTeamIds}) AND deleted_at IS NULL
    `;
    await client`
      UPDATE api_keys SET deleted_at = COALESCE(deleted_at, NOW())
      WHERE team_id = ANY(${expiredTeamIds}) AND deleted_at IS NULL
    `;
  }

  const expiredProjects = await client`
    SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const expiredProjectIds = expiredProjects.map((r) => r.id);

  if (expiredProjectIds.length > 0) {
    await client`
      UPDATE apps SET deleted_at = COALESCE(deleted_at, NOW())
      WHERE project_id = ANY(${expiredProjectIds}) AND deleted_at IS NULL
    `;
    await client`
      UPDATE metric_definitions SET deleted_at = COALESCE(deleted_at, NOW())
      WHERE project_id = ANY(${expiredProjectIds}) AND deleted_at IS NULL
    `;
    await client`
      UPDATE funnel_definitions SET deleted_at = COALESCE(deleted_at, NOW())
      WHERE project_id = ANY(${expiredProjectIds}) AND deleted_at IS NULL
    `;
  }

  // Step 2: Find all apps past cutoff (includes newly cascaded ones from step 1)
  const expiredApps = await client`
    SELECT id FROM apps WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
  `;
  const expiredAppIds = expiredApps.map((r) => r.id);

  // Step 3: Delete event data for expired apps
  if (expiredAppIds.length > 0) {
    // Resolve per-app project_ids before deletion (for audit logging)
    const appProjectRows = await client`
      SELECT id, project_id FROM apps WHERE id = ANY(${expiredAppIds})
    `;
    const projectIdByApp = new Map(appProjectRows.map((r) => [r.id as string, r.project_id as string | null]));

    // Group expired app IDs by project for per-project audit logging
    const appIdsByProject = new Map<string | null, string[]>();
    for (const appId of expiredAppIds) {
      const projectId = projectIdByApp.get(appId) ?? null;
      const list = appIdsByProject.get(projectId) ?? [];
      list.push(appId);
      appIdsByProject.set(projectId, list);
    }

    const eventsDeleted = await client.unsafe(
      `DELETE FROM events WHERE app_id = ANY($1)`,
      [expiredAppIds]
    );
    result.events = Number(eventsDeleted.count ?? 0);

    const metricEventsDeleted = await client.unsafe(
      `DELETE FROM metric_events WHERE app_id = ANY($1)`,
      [expiredAppIds]
    );
    result.metricEvents = Number(metricEventsDeleted.count ?? 0);

    const funnelEventsDeleted = await client.unsafe(
      `DELETE FROM funnel_events WHERE app_id = ANY($1)`,
      [expiredAppIds]
    );
    result.funnelEvents = Number(funnelEventsDeleted.count ?? 0);

    // Log event deletions to audit table (one row per project)
    const auditRows: { project_id: string | null; table_name: string; deleted_count: number }[] = [];
    for (const [projectId] of appIdsByProject) {
      if (result.events > 0) auditRows.push({ project_id: projectId, table_name: "events", deleted_count: result.events });
      if (result.metricEvents > 0) auditRows.push({ project_id: projectId, table_name: "metric_events", deleted_count: result.metricEvents });
      if (result.funnelEvents > 0) auditRows.push({ project_id: projectId, table_name: "funnel_events", deleted_count: result.funnelEvents });
    }
    for (const row of auditRows) {
      await client`
        INSERT INTO event_deletions (project_id, table_name, reason, cutoff_date, deleted_count)
        VALUES (${row.project_id}, ${row.table_name}, 'soft_delete_cleanup', ${cutoff}, ${row.deleted_count})
      `;
    }

    // Junction entries (app_user_apps) cascade-delete when apps are hard-deleted below.
    // app_users rows persist (project-scoped) and cascade-delete when the project is deleted.

    // Hard-delete api_keys for these apps
    const appKeysDeleted = await client`
      DELETE FROM api_keys WHERE app_id = ANY(${expiredAppIds})
    `;
    result.apiKeys += Number(appKeysDeleted.count ?? 0);

    // Hard-delete the apps (cascades app_user_apps junction entries)
    const appsDeleted = await client`
      DELETE FROM apps WHERE id = ANY(${expiredAppIds})
    `;
    result.apps = Number(appsDeleted.count ?? 0);
  }

  // Step 4: Delete definitions for expired projects
  if (expiredProjectIds.length > 0) {
    const metricDefsDeleted = await client`
      DELETE FROM metric_definitions WHERE project_id = ANY(${expiredProjectIds})
    `;
    result.metricDefinitions = Number(metricDefsDeleted.count ?? 0);

    const funnelDefsDeleted = await client`
      DELETE FROM funnel_definitions WHERE project_id = ANY(${expiredProjectIds})
    `;
    result.funnelDefinitions = Number(funnelDefsDeleted.count ?? 0);

    // Hard-delete the projects
    const projectsDeleted = await client`
      DELETE FROM projects WHERE id = ANY(${expiredProjectIds})
    `;
    result.projects = Number(projectsDeleted.count ?? 0);
  }

  // Step 5: Delete remaining resources for expired teams
  if (expiredTeamIds.length > 0) {
    const invitationsDeleted = await client`
      DELETE FROM team_invitations WHERE team_id = ANY(${expiredTeamIds})
    `;
    result.teamInvitations = Number(invitationsDeleted.count ?? 0);

    const membersDeleted = await client`
      DELETE FROM team_members WHERE team_id = ANY(${expiredTeamIds})
    `;
    result.teamMembers = Number(membersDeleted.count ?? 0);

    const auditDeleted = await client`
      DELETE FROM audit_logs WHERE team_id = ANY(${expiredTeamIds})
    `;
    result.auditLogs = Number(auditDeleted.count ?? 0);

    // Remaining team-scoped api_keys (e.g. agent keys without app_id)
    const teamKeysDeleted = await client`
      DELETE FROM api_keys WHERE team_id = ANY(${expiredTeamIds})
    `;
    result.apiKeys += Number(teamKeysDeleted.count ?? 0);

    // Hard-delete the teams
    const teamsDeleted = await client`
      DELETE FROM teams WHERE id = ANY(${expiredTeamIds})
    `;
    result.teams = Number(teamsDeleted.count ?? 0);
  }

  return result;
}

// ── Standalone script ────────────────────────────────────────────────

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: "../../.env" });

  const pg = await import("postgres");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const client = pg.default(databaseUrl, { max: 1 });

  try {
    console.log("Running soft-delete cleanup (cutoff: 7 days)...");
    const result = await cleanupSoftDeletedResources(client);

    const total = Object.values(result).reduce((a, b) => a + b, 0);
    if (total === 0) {
      console.log("Nothing to clean up.");
    } else {
      console.log("Cleanup complete:");
      for (const [key, count] of Object.entries(result)) {
        if (count > 0) console.log(`  ${key}: ${count}`);
      }
    }
  } finally {
    await client.end();
  }
}
