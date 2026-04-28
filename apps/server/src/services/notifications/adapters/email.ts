import type { EmailService, IssueDigestEmailParams, JobAlertEmailParams } from "../../email.js";
import type { ChannelAdapter, ChannelDeliveryContext, ChannelDeliveryResult } from "../types.js";

/**
 * Wraps the existing EmailService. Per-type formatting lives here so the
 * dispatcher stays content-agnostic. Falls back to a generic email when the
 * notification type doesn't have a richer template.
 *
 * Verification codes and team invitations do NOT route through this adapter —
 * they're transactional and may target email addresses that aren't yet users.
 * They keep going through EmailService directly.
 */
export function createEmailAdapter(emailService: EmailService): ChannelAdapter {
  return {
    channel: "email",
    async deliver(ctx: ChannelDeliveryContext): Promise<ChannelDeliveryResult> {
      try {
        switch (ctx.type) {
          case "issue.digest": {
            const params = extractIssueDigestParams(ctx);
            await emailService.sendIssueDigest(ctx.userEmail, params);
            return { status: "sent", metadata: { template: "issue.digest" } };
          }
          case "feedback.new": {
            await emailService.sendGenericNotification(ctx.userEmail, {
              subject: ctx.payload.title,
              body: ctx.payload.body ?? "",
              link: ctx.payload.link
                ? `${process.env.WEB_APP_URL ?? "https://owlmetry.com"}${ctx.payload.link}`
                : undefined,
              link_text: "View feedback",
            });
            return { status: "sent", metadata: { template: "feedback.new" } };
          }
          case "issue.new": {
            await emailService.sendGenericNotification(ctx.userEmail, {
              subject: ctx.payload.title,
              body: ctx.payload.body ?? "",
              link: ctx.payload.link
                ? `${process.env.WEB_APP_URL ?? "https://owlmetry.com"}${ctx.payload.link}`
                : undefined,
              link_text: "View issues",
            });
            return { status: "sent", metadata: { template: "issue.new" } };
          }
          case "job.completed": {
            const params = extractJobAlertParams(ctx);
            await emailService.sendJobAlert(ctx.userEmail, params);
            return { status: "sent", metadata: { template: "job.completed" } };
          }
          case "app.rating_changed": {
            await emailService.sendGenericNotification(ctx.userEmail, {
              subject: ctx.payload.title,
              body: ctx.payload.body ?? "",
              link: ctx.payload.link
                ? `${process.env.WEB_APP_URL ?? "https://owlmetry.com"}${ctx.payload.link}`
                : undefined,
              link_text: "View app",
            });
            return { status: "sent", metadata: { template: "app.rating_changed" } };
          }
          case "app.review_new": {
            await emailService.sendGenericNotification(ctx.userEmail, {
              subject: ctx.payload.title,
              body: ctx.payload.body ?? "",
              link: ctx.payload.link
                ? `${process.env.WEB_APP_URL ?? "https://owlmetry.com"}${ctx.payload.link}`
                : undefined,
              link_text: "View reviews",
            });
            return { status: "sent", metadata: { template: "app.review_new" } };
          }
          case "team.invitation":
            return { status: "skipped", reason: "team.invitation is transactional, not dispatched" };
          default:
            return { status: "skipped", reason: `no email template for ${ctx.type}` };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { status: "failed", error: msg };
      }
    },
  };
}

function extractIssueDigestParams(ctx: ChannelDeliveryContext): IssueDigestEmailParams {
  const data = ctx.payload.data ?? {};
  return {
    project_name: typeof data.project_name === "string" ? data.project_name : "your project",
    issues: Array.isArray(data.issues)
      ? (data.issues as IssueDigestEmailParams["issues"])
      : [],
    dashboard_url:
      typeof data.dashboard_url === "string"
        ? data.dashboard_url
        : `${process.env.WEB_APP_URL ?? "https://owlmetry.com"}/dashboard/issues`,
  };
}

function extractJobAlertParams(ctx: ChannelDeliveryContext): JobAlertEmailParams {
  const data = ctx.payload.data ?? {};
  return {
    job_type: typeof data.job_type === "string" ? data.job_type : "Job",
    status: typeof data.status === "string" ? data.status : "completed",
    duration: typeof data.duration === "string" ? data.duration : "",
    error: typeof data.error === "string" ? data.error : undefined,
    result: (data.result as Record<string, unknown>) ?? undefined,
  };
}
