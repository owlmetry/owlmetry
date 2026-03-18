export interface EmailService {
  sendVerificationCode(email: string, code: string): Promise<void>;
}

export class ConsoleEmailService implements EmailService {
  async sendVerificationCode(email: string, code: string): Promise<void> {
    console.log(`\n========================================`);
    console.log(`  Verification code for ${email}: ${code}`);
    console.log(`========================================\n`);
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
}

export function createEmailService(resendApiKey?: string, emailFrom?: string): EmailService {
  if (resendApiKey) {
    return new ResendEmailService(resendApiKey, emailFrom || "noreply@owlmetry.com");
  }
  return new ConsoleEmailService();
}
