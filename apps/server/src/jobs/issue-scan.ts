import { eq, and, isNull, sql } from "drizzle-orm";
import { projects, apps, jobRuns } from "@owlmetry/db";
import { generateIssueFingerprint } from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";

interface ErrorEvent {
  id: string;
  app_id: string;
  client_event_id: string | null;
  session_id: string;
  user_id: string | null;
  message: string;
  source_module: string | null;
  app_version: string | null;
  environment: string | null;
  is_dev: boolean;
  timestamp: Date;
}

export const issueScanHandler: JobHandler = async (ctx) => {
  // 1. Find the last successful scan time
  const [lastRun] = await ctx.db
    .select({ completed_at: jobRuns.completed_at })
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.job_type, "issue_scan"),
        eq(jobRuns.status, "completed"),
      )
    )
    .orderBy(sql`${jobRuns.completed_at} DESC`)
    .limit(1);

  const scanSince = lastRun?.completed_at ?? new Date(Date.now() - 60 * 60 * 1000);

  // 2. Query all active apps with active projects
  const allApps = await ctx.db
    .select({ id: apps.id, project_id: apps.project_id })
    .from(apps)
    .where(isNull(apps.deleted_at));

  const activeProjects = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.deleted_at));
  const activeProjectIds = new Set(activeProjects.map((p) => p.id));
  const activeApps = allApps.filter((a) => activeProjectIds.has(a.project_id));

  let appsScanned = 0;
  let eventsProcessed = 0;
  let issuesCreated = 0;
  let issuesRegressed = 0;
  let occurrencesCreated = 0;

  const client = ctx.createClient();
  try {
    for (const appRow of activeApps) {
      if (ctx.isCancelled()) break;

      // 3. Query error events since last scan
      const scanSinceIso = scanSince.toISOString();
      const errorEvents = await client<ErrorEvent[]>`
        SELECT id, app_id, client_event_id, session_id, user_id, message, source_module,
               app_version, environment, is_dev, "timestamp"
        FROM events
        WHERE app_id = ${appRow.id}
          AND level = 'error'
          AND received_at > ${scanSinceIso}::timestamptz
        ORDER BY "timestamp" ASC
      `;

      if (errorEvents.length === 0) {
        appsScanned++;
        continue;
      }

      // 4. Group events by fingerprint
      const eventsByKey = new Map<string, { event: ErrorEvent; fingerprint: string }[]>();
      for (const event of errorEvents) {
        const fingerprint = await generateIssueFingerprint(event.message, event.source_module);
        const key = `${fingerprint}:${event.is_dev}`;
        const group = eventsByKey.get(key) ?? [];
        group.push({ event, fingerprint });
        eventsByKey.set(key, group);
      }

      // 5. Process each fingerprint group
      const affectedIssueIds = new Set<string>();

      for (const [, group] of eventsByKey) {
        const { fingerprint } = group[0];
        const isDev = group[0].event.is_dev;

        // Look up existing issue via fingerprint table
        const fpRows = await client<{ issue_id: string }[]>`
          SELECT issue_id FROM issue_fingerprints
          WHERE fingerprint = ${fingerprint} AND app_id = ${appRow.id} AND is_dev = ${isDev}
        `;

        let issueId: string;

        if (fpRows.length === 0) {
          // Create new issue
          const firstEvent = group[0].event;
          const timestamps = group.map((g) => new Date(g.event.timestamp).getTime());
          const firstSeen = new Date(Math.min(...timestamps));
          const lastSeen = new Date(Math.max(...timestamps));

          const [inserted] = await client<{ id: string }[]>`
            INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, first_seen_at, last_seen_at)
            VALUES (${appRow.id}, ${appRow.project_id}, 'new', ${firstEvent.message}, ${firstEvent.source_module}, ${isDev}, ${firstSeen.toISOString()}::timestamptz, ${lastSeen.toISOString()}::timestamptz)
            RETURNING id
          `;

          issueId = inserted.id;

          // Insert fingerprint mapping
          await client`
            INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id)
            VALUES (${fingerprint}, ${appRow.id}, ${isDev}, ${issueId})
          `;

          issuesCreated++;
        } else {
          issueId = fpRows[0].issue_id;

          // Check for regression
          const issueRows = await client<{ status: string; resolved_at_version: string | null }[]>`
            SELECT status, resolved_at_version FROM issues WHERE id = ${issueId}
          `;

          if (issueRows.length > 0) {
            const issue = issueRows[0];
            if (issue.status === "resolved") {
              const newerVersion = group.find(
                (g) =>
                  g.event.app_version &&
                  issue.resolved_at_version &&
                  g.event.app_version > issue.resolved_at_version
              );

              if (newerVersion) {
                await client`
                  UPDATE issues SET status = 'regressed', resolved_at_version = NULL, updated_at = NOW() WHERE id = ${issueId}
                `;
                issuesRegressed++;
              }
            }
          }
        }

        affectedIssueIds.add(issueId);

        // 6. Insert occurrences (deduplicated by session)
        for (const { event } of group) {
          const eventTimestamp = new Date(event.timestamp).toISOString();
          const result = await client`
            INSERT INTO issue_occurrences (issue_id, session_id, user_id, app_version, environment, event_id, "timestamp")
            VALUES (${issueId}, ${event.session_id}, ${event.user_id}, ${event.app_version}, ${event.environment}::environment, ${event.id}, ${eventTimestamp}::timestamptz)
            ON CONFLICT (issue_id, session_id) DO NOTHING
          `;

          if (result.count > 0) {
            occurrencesCreated++;
          }
        }

        // 7. Link any attachments uploaded alongside these events to this issue so they
        // survive event retention pruning. Matches on both event_id (populated via the
        // ingest backfill) and event_client_id (covers pre-event uploads that never got
        // backfilled because the event was dropped).
        const eventIds = group.map((g) => g.event.id).filter(Boolean);
        const clientEventIds = group
          .map((g) => g.event.client_event_id)
          .filter((id): id is string => !!id);
        if (eventIds.length > 0 || clientEventIds.length > 0) {
          await client`
            UPDATE event_attachments
            SET issue_id = ${issueId}
            WHERE app_id = ${appRow.id}
              AND issue_id IS NULL
              AND deleted_at IS NULL
              AND (
                event_id = ANY(${eventIds}::uuid[])
                OR event_client_id = ANY(${clientEventIds}::uuid[])
              )
          `;
        }
      }

      // 7. Update denormalized counts for affected issues
      if (affectedIssueIds.size > 0) {
        const ids = Array.from(affectedIssueIds);
        await client`
          UPDATE issues SET
            occurrence_count = (SELECT COUNT(*) FROM issue_occurrences WHERE issue_id = issues.id),
            unique_user_count = (SELECT COUNT(DISTINCT user_id) FROM issue_occurrences WHERE issue_id = issues.id AND user_id IS NOT NULL),
            last_seen_at = GREATEST(issues.last_seen_at, (SELECT MAX("timestamp") FROM issue_occurrences WHERE issue_id = issues.id)),
            updated_at = NOW()
          WHERE id = ANY(${ids}::uuid[])
        `;
      }

      eventsProcessed += errorEvents.length;
      appsScanned++;

      await ctx.updateProgress({
        processed: appsScanned,
        total: activeApps.length,
        message: `Scanned ${appsScanned}/${activeApps.length} apps`,
      });
    }
  } finally {
    await client.end();
  }

  if (issuesCreated > 0 || issuesRegressed > 0) {
    ctx.log.info(
      `Issue scan: ${eventsProcessed} error events → ${issuesCreated} new issues, ${issuesRegressed} regressions, ${occurrencesCreated} occurrences across ${appsScanned} apps`
    );
  }

  return {
    apps_scanned: appsScanned,
    events_processed: eventsProcessed,
    issues_created: issuesCreated,
    issues_regressed: issuesRegressed,
    occurrences_created: occurrencesCreated,
    _silent: issuesCreated === 0 && issuesRegressed === 0,
  };
};
