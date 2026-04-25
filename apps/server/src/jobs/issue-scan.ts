import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { projects, apps, issues, jobRuns } from "@owlmetry/db";
import {
  generateIssueFingerprint,
  compareVersions,
  METRIC_MESSAGE_PREFIX,
  STEP_MESSAGE_PREFIX,
  TRACK_MESSAGE_PREFIX,
} from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";
import type { NotificationDispatcher } from "../services/notifications/dispatcher.js";
import { resolveTeamMemberUserIds } from "../utils/team-members.js";

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
  country_code: string | null;
  is_dev: boolean;
  timestamp: Date;
}

interface FingerprintedEvent {
  event: ErrorEvent;
  fingerprint: string;
}

interface IssueMeta {
  status: string;
  resolved_at_version: string | null;
  created_at: Date;
}

function appendToMapList<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// Errors in the same session whose timestamps all fall within this window from
// the burst's first event are aliased onto a single issue. See also
// apps/web/content/docs/concepts/issues.mdx.
const BURST_WINDOW_MS = 5000;

// When creating a new issue from a burst, prefer a message that isn't one of
// these lifecycle-marker prefixes so the issue title is human-readable.
const SPECIALIZED_MESSAGE_PREFIXES = [
  METRIC_MESSAGE_PREFIX,
  STEP_MESSAGE_PREFIX,
  TRACK_MESSAGE_PREFIX,
];

function isSpecializedMessage(message: string): boolean {
  return SPECIALIZED_MESSAGE_PREFIXES.some((p) => message.startsWith(p));
}

function pickTitleEvent(items: FingerprintedEvent[]): ErrorEvent {
  const nonSpecialized = items.find((i) => !isSpecializedMessage(i.event.message));
  return (nonSpecialized ?? items[0]).event;
}

interface IssueSummary {
  id: string;
  title: string;
  app_name: string;
  project_name: string;
  team_id: string;
}

function buildIssueNewPayload(
  newIssues: IssueSummary[],
  regressedIssues: IssueSummary[],
): { title: string; body: string } {
  const newCount = newIssues.length;
  const regCount = regressedIssues.length;

  const titleParts: string[] = [];
  if (newCount > 0) titleParts.push(`${newCount} new ${newCount === 1 ? "issue" : "issues"}`);
  if (regCount > 0) titleParts.push(`${regCount} regressed`);
  const title = titleParts.join(", ");

  const lines: string[] = [];
  for (const issue of newIssues.slice(0, 3)) lines.push(`🆕 ${issue.title}`);
  for (const issue of regressedIssues.slice(0, Math.max(0, 3 - lines.length))) lines.push(`🔄 ${issue.title}`);
  const total = newCount + regCount;
  if (total > lines.length) lines.push(`+${total - lines.length} more`);

  return { title, body: lines.join("\n") };
}

export function issueScanHandler(dispatcher: NotificationDispatcher): JobHandler {
  return async (ctx) => {
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

    // Track IDs of issues created or regressed during this run, partitioned by
    // dev/prod. Only prod issues feed the issue.new push at the end — dev
    // crashes shouldn't ping team members.
    const newIssueIdsProd = new Set<string>();
    const regressedIssueIdsProd = new Set<string>();

    const client = ctx.createClient();
    try {
      for (const appRow of activeApps) {
        if (ctx.isCancelled()) break;

        // 3. Query error events since last scan
        const scanSinceIso = scanSince.toISOString();
        const errorEvents = await client<ErrorEvent[]>`
          SELECT id, app_id, client_event_id, session_id, user_id, message, source_module,
                 app_version, environment, country_code, is_dev, "timestamp"
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

        // 4. Compute fingerprint once per event
        const fingerprinted: FingerprintedEvent[] = await Promise.all(
          errorEvents.map(async (event) => ({
            event,
            fingerprint: await generateIssueFingerprint(event.message, event.source_module),
          }))
        );

        // 5. Group by session_id
        const bySession = new Map<string, FingerprintedEvent[]>();
        for (const item of fingerprinted) {
          const arr = bySession.get(item.event.session_id) ?? [];
          arr.push(item);
          bySession.set(item.event.session_id, arr);
        }

        // 6. Cluster each session's events into bursts. A burst contains events
        // whose timestamps fall within BURST_WINDOW_MS of the burst's first event.
        const bursts: FingerprintedEvent[][] = [];
        for (const [, items] of bySession) {
          items.sort(
            (a, b) => new Date(a.event.timestamp).getTime() - new Date(b.event.timestamp).getTime()
          );
          let current: FingerprintedEvent[] = [];
          let burstStartMs = 0;
          for (const item of items) {
            const t = new Date(item.event.timestamp).getTime();
            if (current.length === 0) {
              current = [item];
              burstStartMs = t;
            } else if (t - burstStartMs <= BURST_WINDOW_MS) {
              current.push(item);
            } else {
              bursts.push(current);
              current = [item];
              burstStartMs = t;
            }
          }
          if (current.length > 0) bursts.push(current);
        }

        // 7. Process each burst. Collect affected issues for count/regression updates.
        // issueMeta is populated during fingerprint lookups so the regression pass
        // below can reuse the data without re-querying per issue.
        const affectedIssueIds = new Set<string>();
        const regressionCandidates = new Map<string, ErrorEvent[]>();
        const issueMeta = new Map<string, IssueMeta>();

        const aliasFingerprints = async (fps: string[], isDev: boolean, issueId: string) => {
          for (const fp of fps) {
            await client`
              INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id)
              VALUES (${fp}, ${appRow.id}, ${isDev}, ${issueId})
              ON CONFLICT (fingerprint, app_id, is_dev) DO NOTHING
            `;
          }
        };

        for (const burst of bursts) {
          // Partition by is_dev so dev and prod never cross-alias.
          const byDev = new Map<boolean, FingerprintedEvent[]>();
          for (const item of burst) {
            appendToMapList(byDev, item.event.is_dev, item);
          }

          for (const [isDev, partitionItems] of byDev) {
            const distinctFps = Array.from(new Set(partitionItems.map((i) => i.fingerprint)));

            // Look up which fingerprints are already mapped, joining onto issues so
            // status/resolved_at_version/created_at come back in one round trip.
            // These feed the oldest-issue tiebreaker below and the regression pass.
            const fpRows = await client<{
              fingerprint: string;
              issue_id: string;
              status: string;
              resolved_at_version: string | null;
              created_at: Date;
            }[]>`
              SELECT fp.fingerprint, fp.issue_id, i.status, i.resolved_at_version, i.created_at
              FROM issue_fingerprints fp
              JOIN issues i ON i.id = fp.issue_id
              WHERE fp.app_id = ${appRow.id}
                AND fp.is_dev = ${isDev}
                AND fp.fingerprint = ANY(${distinctFps}::text[])
            `;
            const fpToIssue = new Map(fpRows.map((r) => [r.fingerprint, r.issue_id]));
            for (const r of fpRows) {
              issueMeta.set(r.issue_id, {
                status: r.status,
                resolved_at_version: r.resolved_at_version,
                created_at: r.created_at,
              });
            }
            const existingIssueIds = Array.from(new Set(fpToIssue.values()));

            if (existingIssueIds.length === 0) {
              // No existing issue in this burst — create one and alias all fingerprints.
              const titleEvent = pickTitleEvent(partitionItems);
              const timestamps = partitionItems.map((i) => new Date(i.event.timestamp).getTime());
              const firstSeen = new Date(Math.min(...timestamps));
              const lastSeen = new Date(Math.max(...timestamps));

              const [inserted] = await client<{ id: string; created_at: Date }[]>`
                INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, first_seen_at, last_seen_at)
                VALUES (${appRow.id}, ${appRow.project_id}, 'new', ${titleEvent.message}, ${titleEvent.source_module}, ${isDev}, ${firstSeen.toISOString()}::timestamptz, ${lastSeen.toISOString()}::timestamptz)
                RETURNING id, created_at
              `;
              issuesCreated++;
              issueMeta.set(inserted.id, { status: "new", resolved_at_version: null, created_at: inserted.created_at });
              if (!isDev) newIssueIdsProd.add(inserted.id);

              for (const fp of distinctFps) fpToIssue.set(fp, inserted.id);
              await aliasFingerprints(distinctFps, isDev, inserted.id);
            } else {
              // At least one fingerprint in the burst already has an issue.
              // Conservative rule: never merge two pre-existing issues; only
              // alias previously-unseen fingerprints to the oldest existing issue.
              const aliasTarget = existingIssueIds.reduce((oldest, id) =>
                issueMeta.get(id)!.created_at < issueMeta.get(oldest)!.created_at ? id : oldest
              );
              const newFps = distinctFps.filter((fp) => !fpToIssue.has(fp));
              for (const fp of newFps) fpToIssue.set(fp, aliasTarget);
              await aliasFingerprints(newFps, isDev, aliasTarget);
            }

            // 8. Attach each event as an occurrence of the issue its fingerprint maps to.
            const issueToEventIds = new Map<string, string[]>();
            const issueToClientEventIds = new Map<string, string[]>();

            for (const { event, fingerprint } of partitionItems) {
              const issueId = fpToIssue.get(fingerprint);
              if (!issueId) continue;

              const eventTimestamp = new Date(event.timestamp).toISOString();
              const result = await client`
                INSERT INTO issue_occurrences (issue_id, session_id, user_id, app_version, environment, event_id, country_code, "timestamp")
                VALUES (${issueId}, ${event.session_id}, ${event.user_id}, ${event.app_version}, ${event.environment}::environment, ${event.id}, ${event.country_code}, ${eventTimestamp}::timestamptz)
                ON CONFLICT (issue_id, session_id) DO NOTHING
              `;
              if (result.count > 0) occurrencesCreated++;

              affectedIssueIds.add(issueId);
              appendToMapList(regressionCandidates, issueId, event);
              if (event.id) appendToMapList(issueToEventIds, issueId, event.id);
              if (event.client_event_id) appendToMapList(issueToClientEventIds, issueId, event.client_event_id);
            }

            // 9. Link event attachments to the issue their event ended up in.
            // Matches on event_id (populated via the ingest backfill) and
            // event_client_id (covers pre-event uploads whose event was dropped).
            const attachmentIssueIds = new Set([...issueToEventIds.keys(), ...issueToClientEventIds.keys()]);
            for (const issueId of attachmentIssueIds) {
              await client`
                UPDATE event_attachments
                SET issue_id = ${issueId}
                WHERE app_id = ${appRow.id}
                  AND issue_id IS NULL
                  AND deleted_at IS NULL
                  AND (
                    event_id = ANY(${issueToEventIds.get(issueId) ?? []}::uuid[])
                    OR event_client_id = ANY(${issueToClientEventIds.get(issueId) ?? []}::uuid[])
                  )
              `;
            }
          }
        }

        // 10. Regression detection — reuses issue metadata cached during fp lookup,
        // so no extra SELECT per issue is needed.
        for (const [issueId, events] of regressionCandidates) {
          const meta = issueMeta.get(issueId);
          if (!meta || meta.status !== "resolved") continue;

          const regressed = events.some(
            (event) =>
              event.app_version &&
              meta.resolved_at_version &&
              compareVersions(event.app_version, meta.resolved_at_version) > 0
          );
          if (regressed) {
            await client`
              UPDATE issues SET status = 'regressed', resolved_at_version = NULL, updated_at = NOW() WHERE id = ${issueId}
            `;
            issuesRegressed++;
            // Regression candidates are keyed by issue_id whose burst partition
            // determined dev/prod. The issue row itself carries is_dev — read it
            // back to decide whether to push.
            const [{ is_dev: regIsDev }] = await client<{ is_dev: boolean }[]>`
              SELECT is_dev FROM issues WHERE id = ${issueId}
            `;
            if (!regIsDev) regressedIssueIdsProd.add(issueId);
          }
        }

        // 11. Update denormalized counts for affected issues
        if (affectedIssueIds.size > 0) {
          const ids = Array.from(affectedIssueIds);
          await client`
            UPDATE issues SET
              occurrence_count = (SELECT COUNT(*) FROM issue_occurrences WHERE issue_id = issues.id),
              unique_user_count = (SELECT COUNT(DISTINCT user_id) FROM issue_occurrences WHERE issue_id = issues.id AND user_id IS NOT NULL),
              last_seen_at = GREATEST(issues.last_seen_at, (SELECT MAX("timestamp") FROM issue_occurrences WHERE issue_id = issues.id)),
              last_seen_app_version = (
                SELECT app_version FROM issue_occurrences
                WHERE issue_id = issues.id AND app_version IS NOT NULL
                ORDER BY "timestamp" DESC LIMIT 1
              ),
              first_seen_app_version = COALESCE(
                issues.first_seen_app_version,
                (SELECT app_version FROM issue_occurrences
                 WHERE issue_id = issues.id AND app_version IS NOT NULL
                 ORDER BY "timestamp" ASC LIMIT 1)
              ),
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

    // 12. Per-team push: one issue.new notification per team summarizing this
    // run's prod-only created + regressed issues. Skipped silently when none.
    let issueNewNotificationsSent = 0;
    const allTouchedProdIds = [...newIssueIdsProd, ...regressedIssueIdsProd];
    if (allTouchedProdIds.length > 0) {
      const issueRows = await ctx.db
        .select({
          id: issues.id,
          title: issues.title,
          app_id: issues.app_id,
          project_id: issues.project_id,
        })
        .from(issues)
        .where(inArray(issues.id, allTouchedProdIds));

      const projectAppRows = await ctx.db
        .select({
          project_id: projects.id,
          project_name: projects.name,
          team_id: projects.team_id,
        })
        .from(projects)
        .where(inArray(projects.id, Array.from(new Set(issueRows.map((i) => i.project_id)))));
      const projectInfo = new Map(projectAppRows.map((r) => [r.project_id, r]));

      const appRows = await ctx.db
        .select({ id: apps.id, name: apps.name })
        .from(apps)
        .where(inArray(apps.id, Array.from(new Set(issueRows.map((i) => i.app_id)))));
      const appNameMap = new Map(appRows.map((a) => [a.id, a.name]));

      const newSummaries: IssueSummary[] = [];
      const regressedSummaries: IssueSummary[] = [];
      for (const row of issueRows) {
        const proj = projectInfo.get(row.project_id);
        if (!proj) continue;
        const summary: IssueSummary = {
          id: row.id,
          title: row.title,
          app_name: appNameMap.get(row.app_id) ?? "Unknown",
          project_name: proj.project_name,
          team_id: proj.team_id,
        };
        if (newIssueIdsProd.has(row.id)) newSummaries.push(summary);
        else if (regressedIssueIdsProd.has(row.id)) regressedSummaries.push(summary);
      }

      const teamIds = new Set<string>([...newSummaries.map((s) => s.team_id), ...regressedSummaries.map((s) => s.team_id)]);
      for (const teamId of teamIds) {
        const teamNew = newSummaries.filter((s) => s.team_id === teamId);
        const teamRegressed = regressedSummaries.filter((s) => s.team_id === teamId);
        if (teamNew.length === 0 && teamRegressed.length === 0) continue;

        const memberUserIds = await resolveTeamMemberUserIds(ctx.db, teamId);
        if (memberUserIds.length === 0) continue;

        const { title, body } = buildIssueNewPayload(teamNew, teamRegressed);
        const result = await dispatcher.enqueue({
          type: "issue.new",
          userIds: memberUserIds,
          teamId,
          payload: {
            title,
            body,
            link: "/dashboard/issues",
            data: {
              team_id: teamId,
              counts: { new: teamNew.length, regressed: teamRegressed.length },
              new_issues: teamNew.map(({ team_id: _t, ...rest }) => rest),
              regressed_issues: teamRegressed.map(({ team_id: _t, ...rest }) => rest),
            },
          },
        });
        issueNewNotificationsSent += result.notificationIds.length;
      }
    }

    return {
      apps_scanned: appsScanned,
      events_processed: eventsProcessed,
      issues_created: issuesCreated,
      issues_regressed: issuesRegressed,
      occurrences_created: occurrencesCreated,
      issue_new_notifications_sent: issueNewNotificationsSent,
      _silent: issuesCreated === 0 && issuesRegressed === 0,
    };
  };
}
