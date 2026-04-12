import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { projects, issues, apps, teamMembers, users } from "@owlmetry/db";
import type { IssueAlertFrequency } from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";

const FREQUENCY_INTERVAL_MS: Record<Exclude<IssueAlertFrequency, "none">, number> = {
  hourly: 60 * 60 * 1000,
  "6_hourly": 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export const issueNotifyHandler: JobHandler = async (ctx) => {
  // 1. Query all active projects with non-none alert frequency
  const allProjects = await ctx.db
    .select({
      id: projects.id,
      team_id: projects.team_id,
      name: projects.name,
      issue_alert_frequency: projects.issue_alert_frequency,
      created_at: projects.created_at,
    })
    .from(projects)
    .where(isNull(projects.deleted_at));

  const eligibleProjects = allProjects.filter(
    (p) => p.issue_alert_frequency && p.issue_alert_frequency !== "none"
  );

  let projectsChecked = 0;
  let notificationsSent = 0;
  let issuesNotified = 0;

  for (const project of eligibleProjects) {
    if (ctx.isCancelled()) break;

    const frequency = project.issue_alert_frequency as Exclude<IssueAlertFrequency, "none">;
    const intervalMs = FREQUENCY_INTERVAL_MS[frequency];

    // 2. Check if notification is due
    const [lastNotified] = await ctx.db
      .select({ max_notified: sql<Date | null>`MAX(${issues.last_notified_at})` })
      .from(issues)
      .where(
        and(
          eq(issues.project_id, project.id),
          eq(issues.is_dev, false),
        )
      );

    const lastNotifiedAt = lastNotified?.max_notified ?? project.created_at;
    const now = Date.now();
    const elapsed = now - new Date(lastNotifiedAt).getTime();

    if (elapsed < intervalMs) {
      projectsChecked++;
      continue;
    }

    // 3. Query qualifying issues (new or regressed with activity since last notification)
    const qualifyingIssues = await ctx.db
      .select({
        id: issues.id,
        title: issues.title,
        status: issues.status,
        app_id: issues.app_id,
        occurrence_count: issues.occurrence_count,
        unique_user_count: issues.unique_user_count,
      })
      .from(issues)
      .where(
        and(
          eq(issues.project_id, project.id),
          eq(issues.is_dev, false),
          inArray(issues.status, ["new", "regressed"]),
          sql`(${issues.last_notified_at} IS NULL OR ${issues.last_seen_at} > ${issues.last_notified_at})`,
        )
      );

    if (qualifyingIssues.length === 0) {
      projectsChecked++;
      continue;
    }

    // 4. Get app names for the issues
    const appIds = [...new Set(qualifyingIssues.map((i) => i.app_id))];
    const appRows = await ctx.db
      .select({ id: apps.id, name: apps.name })
      .from(apps)
      .where(inArray(apps.id, appIds));
    const appNameMap = new Map(appRows.map((a) => [a.id, a.name]));

    // 5. Get all team member emails
    const members = await ctx.db
      .select({
        email: users.email,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.user_id))
      .where(eq(teamMembers.team_id, project.team_id));

    if (members.length === 0) {
      projectsChecked++;
      continue;
    }

    // 6. Send digest email to each member
    const issueList = qualifyingIssues.map((i) => ({
      title: i.title,
      status: i.status as "new" | "regressed",
      occurrence_count: i.occurrence_count,
      unique_user_count: i.unique_user_count,
      app_name: appNameMap.get(i.app_id) ?? "Unknown",
    }));

    if (!ctx.emailService) {
      projectsChecked++;
      continue;
    }

    const emailPromises = members.map((member) =>
      ctx.emailService!.sendIssueDigest(member.email, {
        project_name: project.name,
        issues: issueList,
        dashboard_url: `${process.env.WEB_URL ?? "https://owlmetry.com"}/dashboard/issues`,
      }).then(() => {
        notificationsSent++;
      }).catch((err) => {
        ctx.log.error(`Failed to send issue digest to ${member.email}:`, err);
      })
    );
    await Promise.all(emailPromises);

    // 7. Update last_notified_at on notified issues
    const issueIds = qualifyingIssues.map((i) => i.id);
    await ctx.db
      .update(issues)
      .set({ last_notified_at: new Date() })
      .where(inArray(issues.id, issueIds));

    issuesNotified += issueIds.length;
    projectsChecked++;

    await ctx.updateProgress({
      processed: projectsChecked,
      total: eligibleProjects.length,
      message: `Checked ${projectsChecked}/${eligibleProjects.length} projects`,
    });
  }

  if (notificationsSent > 0) {
    ctx.log.info(
      `Issue notifications: sent ${notificationsSent} emails for ${issuesNotified} issues across ${projectsChecked} projects`
    );
  }

  return {
    projects_checked: projectsChecked,
    notifications_sent: notificationsSent,
    issues_notified: issuesNotified,
    _silent: notificationsSent === 0,
  };
};
