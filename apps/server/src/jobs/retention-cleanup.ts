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

  // Fetch all active apps in one query to avoid N+1
  const allApps = await ctx.db
    .select({ id: apps.id, project_id: apps.project_id })
    .from(apps)
    .where(isNull(apps.deleted_at));
  const appsByProject = new Map<string, typeof allApps>();
  for (const app of allApps) {
    const list = appsByProject.get(app.project_id) ?? [];
    list.push(app);
    appsByProject.set(app.project_id, list);
  }

  let totalEvents = 0;
  let totalMetricEvents = 0;
  let totalFunnelEvents = 0;
  let projectsProcessed = 0;

  const client = ctx.createClient();
  try {
    for (const project of allProjects) {
      if (ctx.isCancelled()) break;

      const appIds = (appsByProject.get(project.id) ?? []).map((a: { id: string }) => a.id);
      if (appIds.length === 0) {
        projectsProcessed++;
        continue;
      }

      const retentionEvents = project.retention_days_events ?? DEFAULT_RETENTION_DAYS_EVENTS;
      const retentionMetrics = project.retention_days_metrics ?? DEFAULT_RETENTION_DAYS_METRICS;
      const retentionFunnels = project.retention_days_funnels ?? DEFAULT_RETENTION_DAYS_FUNNELS;

      const result = await enforceRetentionForProject(client, {
        projectId: project.id,
        appIds,
        retentionDaysEvents: retentionEvents,
        retentionDaysMetrics: retentionMetrics,
        retentionDaysFunnels: retentionFunnels,
      });

      // Log audit records for each table that had deletions
      const now = new Date();
      const auditEntries: { table_name: string; deleted_count: number; cutoff_date: Date }[] = [];
      if (result.eventsDeleted > 0) {
        auditEntries.push({
          table_name: "events",
          deleted_count: result.eventsDeleted,
          cutoff_date: new Date(now.getTime() - retentionEvents * 24 * 60 * 60 * 1000),
        });
      }
      if (result.metricEventsDeleted > 0) {
        auditEntries.push({
          table_name: "metric_events",
          deleted_count: result.metricEventsDeleted,
          cutoff_date: new Date(now.getTime() - retentionMetrics * 24 * 60 * 60 * 1000),
        });
      }
      if (result.funnelEventsDeleted > 0) {
        auditEntries.push({
          table_name: "funnel_events",
          deleted_count: result.funnelEventsDeleted,
          cutoff_date: new Date(now.getTime() - retentionFunnels * 24 * 60 * 60 * 1000),
        });
      }

      if (auditEntries.length > 0) {
        await ctx.db.insert(eventDeletions).values(
          auditEntries.map((e) => ({
            project_id: project.id,
            table_name: e.table_name,
            reason: "retention",
            cutoff_date: e.cutoff_date,
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
