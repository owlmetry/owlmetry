import { eq, and, isNull } from "drizzle-orm";
import { projects, apps, eventDeletions, enforceRetentionForProject } from "@owlmetry/db";
import {
  DEFAULT_RETENTION_DAYS_EVENTS,
  DEFAULT_RETENTION_DAYS_METRICS,
  DEFAULT_RETENTION_DAYS_FUNNELS,
} from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";

export const retentionCleanupHandler: JobHandler = async (ctx) => {
  const allProjects = await ctx.db
    .select({
      id: projects.id,
      retention_days_events: projects.retention_days_events,
      retention_days_metrics: projects.retention_days_metrics,
      retention_days_funnels: projects.retention_days_funnels,
    })
    .from(projects)
    .where(isNull(projects.deleted_at));

  let totalEvents = 0;
  let totalMetricEvents = 0;
  let totalFunnelEvents = 0;
  let projectsProcessed = 0;

  const client = ctx.createClient();
  try {
    for (const project of allProjects) {
      if (ctx.isCancelled()) break;

      const projectApps = await ctx.db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.project_id, project.id), isNull(apps.deleted_at)));
      const appIds = projectApps.map((a) => a.id);

      if (appIds.length === 0) {
        projectsProcessed++;
        continue;
      }

      const result = await enforceRetentionForProject(client, {
        projectId: project.id,
        appIds,
        retentionDaysEvents: project.retention_days_events ?? DEFAULT_RETENTION_DAYS_EVENTS,
        retentionDaysMetrics: project.retention_days_metrics ?? DEFAULT_RETENTION_DAYS_METRICS,
        retentionDaysFunnels: project.retention_days_funnels ?? DEFAULT_RETENTION_DAYS_FUNNELS,
      });

      // Log audit records for each table that had deletions
      const auditEntries: { table_name: string; deleted_count: number; cutoff_days: number }[] = [];
      if (result.eventsDeleted > 0) {
        auditEntries.push({
          table_name: "events",
          deleted_count: result.eventsDeleted,
          cutoff_days: project.retention_days_events ?? DEFAULT_RETENTION_DAYS_EVENTS,
        });
      }
      if (result.metricEventsDeleted > 0) {
        auditEntries.push({
          table_name: "metric_events",
          deleted_count: result.metricEventsDeleted,
          cutoff_days: project.retention_days_metrics ?? DEFAULT_RETENTION_DAYS_METRICS,
        });
      }
      if (result.funnelEventsDeleted > 0) {
        auditEntries.push({
          table_name: "funnel_events",
          deleted_count: result.funnelEventsDeleted,
          cutoff_days: project.retention_days_funnels ?? DEFAULT_RETENTION_DAYS_FUNNELS,
        });
      }

      if (auditEntries.length > 0) {
        const now = new Date();
        await ctx.db.insert(eventDeletions).values(
          auditEntries.map((e) => ({
            project_id: project.id,
            table_name: e.table_name,
            reason: "retention",
            cutoff_date: new Date(now.getTime() - e.cutoff_days * 24 * 60 * 60 * 1000),
            deleted_count: e.deleted_count,
          }))
        );
      }

      totalEvents += result.eventsDeleted;
      totalMetricEvents += result.metricEventsDeleted;
      totalFunnelEvents += result.funnelEventsDeleted;
      projectsProcessed++;

      await ctx.updateProgress({
        processed: projectsProcessed,
        total: allProjects.length,
        message: `Processed ${projectsProcessed}/${allProjects.length} projects`,
      });
    }
  } finally {
    await client.end();
  }

  const total = totalEvents + totalMetricEvents + totalFunnelEvents;
  if (total > 0) {
    ctx.log.info(
      `Retention cleanup: ${totalEvents} events, ${totalMetricEvents} metric events, ${totalFunnelEvents} funnel events deleted across ${projectsProcessed} projects`
    );
  }

  return {
    projects_processed: projectsProcessed,
    events_deleted: totalEvents,
    metric_events_deleted: totalMetricEvents,
    funnel_events_deleted: totalFunnelEvents,
    _silent: total === 0,
  };
};
