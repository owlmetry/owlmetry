import { Command } from "commander";
import chalk from "chalk";
import { saveConfig, getGlobals } from "../config.js";

const DEFAULT_ENDPOINT = "https://api.owlmetry.com";

function resolveEndpoint(globals: { endpoint?: string }): string {
  return globals.endpoint || process.env.OWLMETRY_ENDPOINT || DEFAULT_ENDPOINT;
}

async function apiPost<T>(endpoint: string, path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${endpoint.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as T;
  return { status: res.status, data };
}

export const authCommand = new Command("auth")
  .description("Authenticate with an OwlMetry server");

// owlmetry auth send-code --email alice@example.com
authCommand
  .command("send-code")
  .description("Send a verification code to an email address")
  .requiredOption("--email <email>", "Email address")
  .action(async (_opts, cmd) => {
    const globals = getGlobals(cmd);
    const endpoint = resolveEndpoint(globals);
    const email = cmd.optsWithGlobals().email as string;
    const format = globals.format;

    const { status, data } = await apiPost<{ message?: string; error?: string }>(
      endpoint, "/v1/auth/send-code", { email }
    );

    if (status !== 200) {
      const msg = (data as any).error || "Failed to send code";
      if (format === "json") {
        console.log(JSON.stringify({ error: msg, status }));
      } else {
        console.error(chalk.red(msg));
      }
      process.exit(1);
    }

    if (format === "json") {
      console.log(JSON.stringify({ message: data.message, email, endpoint }));
    } else {
      console.log(chalk.green(`✓ Verification code sent to ${email}`));
      console.log(`  Check your email or server logs for the 6-digit code.`);
    }
  });

// owlmetry auth verify --email alice@example.com --code 847291
authCommand
  .command("verify")
  .description("Verify code and get an agent API key")
  .requiredOption("--email <email>", "Email address")
  .requiredOption("--code <code>", "6-digit verification code")
  .option("--team-id <id>", "Team ID (required if you belong to multiple teams)")
  .action(async (_opts, cmd) => {
    const globals = getGlobals(cmd);
    const endpoint = resolveEndpoint(globals);
    const opts = cmd.optsWithGlobals();
    const email = opts.email as string;
    const code = opts.code as string;
    const teamId = opts.teamId as string | undefined;
    const format = globals.format;

    const { status, data } = await apiPost<{
      api_key?: string;
      team?: { id: string; name: string; slug: string };
      project?: { id: string; name: string; slug: string } | null;
      app?: { id: string; name: string; platform: string } | null;
      is_new_setup?: boolean;
      error?: string;
      teams?: Array<{ id: string; name: string; slug: string; role: string }>;
    }>(endpoint, "/v1/auth/agent-login", { email, code, team_id: teamId });

    if (status !== 201) {
      if (format === "json") {
        console.log(JSON.stringify(data));
      } else if ((data as any).teams) {
        console.error(chalk.yellow("Multiple teams found. Re-run with --team-id:"));
        for (const t of (data as any).teams) {
          console.error(`  ${t.id}  ${t.name} (${t.role})`);
        }
      } else {
        console.error(chalk.red((data as any).error || "Verification failed"));
      }
      process.exit(1);
    }

    const { api_key, team, project, app, is_new_setup } = data;

    if (!api_key) {
      console.error(chalk.red("No API key returned"));
      process.exit(1);
    }

    saveConfig({ endpoint, api_key });

    if (format === "json") {
      console.log(JSON.stringify({ api_key, endpoint, team, project, app, is_new_setup }, null, 2));
    } else {
      console.log(chalk.green("✓ Authenticated! Config saved to ~/.owlmetry/config.json"));
      console.log(`  Team:    ${team?.name}`);
      if (project) console.log(`  Project: ${project.name}`);
      if (app) console.log(`  App:     ${app.name} (${app.platform})`);
    }
  });
