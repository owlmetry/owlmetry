import { eq, and, isNull, sql } from "drizzle-orm";
import { projects, apps, jobRuns } from "@owlmetry/db";
import {
  generateIssueFingerprint,
  compareVersions,
  METRIC_MESSAGE_PREFIX,
  STEP_MESSAGE_PREFIX,
  TRACK_MESSAGE_PREFIX,
} from "@owlmetry/shared";
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

  return {
    apps_scanned: appsScanned,
    events_processed: eventsProcessed,
    issues_created: issuesCreated,
    issues_regressed: issuesRegressed,
    occurrences_created: occurrencesCreated,
    _silent: issuesCreated === 0 && issuesRegressed === 0,
  };
};
