import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TeamInvitationEmailParams {
  team_name: string;
  invited_by_name: string;
  role: string;
  accept_url: string;
}

export interface JobAlertEmailParams {
  job_type: string;
  status: string;
  duration: string;
  error?: string;
  result?: Record<string, unknown>;
}

export interface IssueDigestEmailParams {
  project_name: string;
  issues: Array<{
    title: string;
    status: "new" | "regressed";
    occurrence_count: number;
    unique_user_count: number;
    app_name: string;
  }>;
  dashboard_url: string;
}

export interface GenericNotificationParams {
  subject: string;
  body: string;
  link?: string;
  link_text?: string;
}

export interface EmailService {
  sendVerificationCode(email: string, code: string): Promise<void>;
  sendTeamInvitation(email: string, params: TeamInvitationEmailParams): Promise<void>;
  sendJobAlert(email: string, params: JobAlertEmailParams): Promise<void>;
  sendIssueDigest(email: string, params: IssueDigestEmailParams): Promise<void>;
  /** Plain notification email for types without a richer template (e.g. feedback.new). */
  sendGenericNotification(email: string, params: GenericNotificationParams): Promise<void>;
}

/** Escape user-controlled strings before interpolation into HTML emails. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function jobStatusEmoji(status: string): string {
  return status === "completed" ? "✅" : status === "failed" ? "❌" : "🚫";
}

/** Project root — 4 levels up from apps/server/src/services/ */
const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..");
const DEV_CODE_PATH = resolve(PROJECT_ROOT, ".dev-verification-code");
const DEV_INVITATION_PATH = resolve(PROJECT_ROOT, ".dev-invitation-link");

export class ConsoleEmailService implements EmailService {
  async sendVerificationCode(email: string, code: string): Promise<void> {
    console.log(`\n========================================`);
    console.log(`  Verification code for ${email}: ${code}`);
    console.log(`========================================\n`);
    try {
      writeFileSync(DEV_CODE_PATH, JSON.stringify({ email, code, timestamp: new Date().toISOString() }) + "\n");
    } catch {
      // Non-critical — don't break auth if file write fails
    }
  }

  async sendTeamInvitation(email: string, params: TeamInvitationEmailParams): Promise<void> {
    console.log(`\n========================================`);
    console.log(`  Team invitation for ${email}`);
    console.log(`  Team: ${params.team_name} | Role: ${params.role}`);
    console.log(`  Invited by: ${params.invited_by_name}`);
    console.log(`  Accept: ${params.accept_url}`);
    console.log(`========================================\n`);
    try {
      writeFileSync(DEV_INVITATION_PATH, JSON.stringify({
        email,
        team_name: params.team_name,
        accept_url: params.accept_url,
        timestamp: new Date().toISOString(),
      }) + "\n");
    } catch {
      // Non-critical
    }
  }

  async sendJobAlert(email: string, params: JobAlertEmailParams): Promise<void> {
    const emoji = jobStatusEmoji(params.status);
    console.log(`\n========================================`);
    console.log(`  ${emoji} Job ${params.status}: ${params.job_type}`);
    console.log(`  To: ${email} | Duration: ${params.duration}`);
    if (params.error) console.log(`  Error: ${params.error}`);
    console.log(`========================================\n`);
  }

  async sendIssueDigest(email: string, params: IssueDigestEmailParams): Promise<void> {
    console.log(`\n========================================`);
    console.log(`  🐛 Issue Digest: ${params.project_name}`);
    console.log(`  To: ${email} | ${params.issues.length} issue(s)`);
    for (const issue of params.issues) {
      const statusEmoji = issue.status === "regressed" ? "🔄" : "🆕";
      console.log(`  ${statusEmoji} ${issue.title.slice(0, 60)} (${issue.occurrence_count} occ, ${issue.unique_user_count} users) [${issue.app_name}]`);
    }
    console.log(`========================================\n`);
  }

  async sendGenericNotification(email: string, params: GenericNotificationParams): Promise<void> {
    console.log(`\n========================================`);
    console.log(`  🔔 ${params.subject}`);
    console.log(`  To: ${email}`);
    if (params.body) console.log(`  ${params.body.slice(0, 200)}`);
    if (params.link) console.log(`  Link: ${params.link}`);
    console.log(`========================================\n`);
  }
}

export class ResendEmailService implements EmailService {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: this.from, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error (${res.status}): ${body}`);
    }
  }

  async sendVerificationCode(email: string, code: string): Promise<void> {
    await this.sendEmail(email, "Your Owlmetry verification code", [
      `<p>Your verification code is:</p>`,
      `<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0;">${code}</p>`,
      `<p>Pass this code to your AI agent to authenticate the Owlmetry CLI, or enter it in the dashboard to sign in.</p>`,
      `<p style="color:#888;font-size:13px;">This code expires in 10 minutes.</p>`,
    ].join(""));
  }

  async sendTeamInvitation(email: string, params: TeamInvitationEmailParams): Promise<void> {
    await this.sendEmail(email, `You've been invited to join ${params.team_name} on Owlmetry`, [
      `<p><strong>${escapeHtml(params.invited_by_name)}</strong> invited you to join <strong>${escapeHtml(params.team_name)}</strong> as <strong>${escapeHtml(params.role)}</strong>.</p>`,
      `<p><a href="${escapeHtml(params.accept_url)}" style="display:inline-block;padding:12px 24px;background:#e8590c;color:#fff;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>`,
      `<p style="color:#888;font-size:13px;">This invitation expires in 7 days.</p>`,
    ].join(""));
  }

  async sendJobAlert(email: string, params: JobAlertEmailParams): Promise<void> {
    const emoji = jobStatusEmoji(params.status);
    const lines = [
      `<p><strong>Job:</strong> ${escapeHtml(params.job_type)}</p>`,
      `<p><strong>Status:</strong> ${escapeHtml(params.status)}</p>`,
      `<p><strong>Duration:</strong> ${escapeHtml(params.duration)}</p>`,
    ];
    if (params.error) lines.push(`<p><strong>Error:</strong> ${escapeHtml(params.error)}</p>`);
    if (params.result) lines.push(`<p><strong>Result:</strong></p><pre>${escapeHtml(JSON.stringify(params.result, null, 2))}</pre>`);

    await this.sendEmail(email, `[Owlmetry] ${emoji} Job ${params.status}: ${escapeHtml(params.job_type)}`, lines.join(""));
  }

  async sendIssueDigest(email: string, params: IssueDigestEmailParams): Promise<void> {
    const issueRows = params.issues.map((issue) => {
      const statusEmoji = issue.status === "regressed" ? "🔄" : "🆕";
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${statusEmoji} ${escapeHtml(issue.status)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(issue.title.length > 80 ? issue.title.slice(0, 77) + "..." : issue.title)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${issue.occurrence_count}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${issue.unique_user_count}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(issue.app_name)}</td>
      </tr>`;
    }).join("");

    await this.sendEmail(email, `[Owlmetry] 🐛 ${params.issues.length} issue(s) in ${escapeHtml(params.project_name)}`, [
      `<p>New issues detected in <strong>${escapeHtml(params.project_name)}</strong>:</p>`,
      `<table style="border-collapse:collapse;width:100%;font-size:14px">`,
      `<thead><tr style="background:#f5f5f5">`,
      `<th style="padding:8px;text-align:left">Status</th>`,
      `<th style="padding:8px;text-align:left">Title</th>`,
      `<th style="padding:8px;text-align:center">Occurrences</th>`,
      `<th style="padding:8px;text-align:center">Users</th>`,
      `<th style="padding:8px;text-align:left">App</th>`,
      `</tr></thead>`,
      `<tbody>${issueRows}</tbody>`,
      `</table>`,
      `<p><a href="${escapeHtml(params.dashboard_url)}" style="display:inline-block;padding:12px 24px;background:#e8590c;color:#fff;text-decoration:none;border-radius:6px;margin-top:16px">View Issues</a></p>`,
    ].join(""));
  }

  async sendGenericNotification(email: string, params: GenericNotificationParams): Promise<void> {
    const linkHtml = params.link
      ? `<p><a href="${escapeHtml(params.link)}" style="display:inline-block;padding:12px 24px;background:#e8590c;color:#fff;text-decoration:none;border-radius:6px;margin-top:8px">${escapeHtml(params.link_text ?? "Open")}</a></p>`
      : "";
    await this.sendEmail(email, `[Owlmetry] ${params.subject}`, [
      `<p>${escapeHtml(params.body)}</p>`,
      linkHtml,
    ].join(""));
  }
}

export function createEmailService(resendApiKey?: string, emailFrom?: string): EmailService {
  if (resendApiKey) {
    return new ResendEmailService(resendApiKey, emailFrom || "noreply@owlmetry.com");
  }
  return new ConsoleEmailService();
}
