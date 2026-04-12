import type postgres from "postgres";

export interface RetentionConfig {
  projectId: string;
  appIds: string[];
  retentionDaysEvents: number;
  retentionDaysMetrics: number;
  retentionDaysFunnels: number;
}

export interface RetentionResult {
  projectId: string;
  eventsDeleted: number;
  metricEventsDeleted: number;
  funnelEventsDeleted: number;
}

export async function enforceRetentionForProject(
  client: postgres.Sql,
  config: RetentionConfig
): Promise<RetentionResult> {
  const result: RetentionResult = {
    projectId: config.projectId,
    eventsDeleted: 0,
    metricEventsDeleted: 0,
    funnelEventsDeleted: 0,
  };

  if (config.appIds.length === 0) return result;

  const eventsCutoff = daysAgo(config.retentionDaysEvents);
  result.eventsDeleted = await deleteByTimestamp(
    client,
    "events",
    config.appIds,
    eventsCutoff
  );

  const metricsCutoff = daysAgo(config.retentionDaysMetrics);
  result.metricEventsDeleted = await deleteByTimestamp(
    client,
    "metric_events",
    config.appIds,
    metricsCutoff
  );

  const funnelsCutoff = daysAgo(config.retentionDaysFunnels);
  result.funnelEventsDeleted = await deleteByTimestamp(
    client,
    "funnel_events",
    config.appIds,
    funnelsCutoff
  );

  return result;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

const ALLOWED_EVENT_TABLES = new Set(["events", "metric_events", "funnel_events"]);

async function deleteByTimestamp(
  client: postgres.Sql,
  tableName: string,
  appIds: string[],
  cutoff: Date
): Promise<number> {
  if (!ALLOWED_EVENT_TABLES.has(tableName)) {
    throw new Error(`deleteByTimestamp: invalid table name "${tableName}"`);
  }
  // Direct DELETE — PostgreSQL routes to the correct partitions automatically.
  // The WHERE uses (app_id, timestamp) which matches existing partition indexes.
  // Uses unsafe() for dynamic table name, with explicit cast for timestamp param.
  const cutoffIso = cutoff.toISOString();
  const deleted = await client.unsafe(
    `DELETE FROM ${tableName}
     WHERE app_id = ANY($1::uuid[])
       AND "timestamp" < $2::timestamptz`,
    [appIds, cutoffIso]
  );

  return Number(deleted.count ?? 0);
}
