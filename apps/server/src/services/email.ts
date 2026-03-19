import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TeamInvitationEmailParams {
  team_name: string;
  invited_by_name: string;
  role: string;
  accept_url: string;
}

export interface EmailService {
  sendVerificationCode(email: string, code: string): Promise<void>;
  sendTeamInvitation(email: string, params: TeamInvitationEmailParams): Promise<void>;
}

/** Escape user-controlled strings before interpolation into HTML emails. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
}

export class ResendEmailService implements EmailService {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async sendVerificationCode(email: string, code: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: email,
        subject: "Your OwlMetry verification code",
        html: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error (${res.status}): ${body}`);
    }
  }

  async sendTeamInvitation(email: string, params: TeamInvitationEmailParams): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: email,
        subject: `You've been invited to join ${params.team_name} on OwlMetry`,
        html: [
          `<p><strong>${escapeHtml(params.invited_by_name)}</strong> invited you to join <strong>${escapeHtml(params.team_name)}</strong> as <strong>${escapeHtml(params.role)}</strong>.</p>`,
          `<p><a href="${escapeHtml(params.accept_url)}" style="display:inline-block;padding:12px 24px;background:#e8590c;color:#fff;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>`,
          `<p style="color:#888;font-size:13px;">This invitation expires in 7 days.</p>`,
        ].join(""),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error (${res.status}): ${body}`);
    }
  }
}

export function createEmailService(resendApiKey?: string, emailFrom?: string): EmailService {
  if (resendApiKey) {
    return new ResendEmailService(resendApiKey, emailFrom || "noreply@owlmetry.com");
  }
  return new ConsoleEmailService();
}
