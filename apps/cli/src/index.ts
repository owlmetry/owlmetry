import { Command, Option } from "commander";
import chalk from "chalk";
import { ApiError } from "./client.js";
import { setupCommand } from "./commands/setup.js";
import { projectsCommand } from "./commands/projects.js";
import { appsCommand } from "./commands/apps.js";
import { eventsCommand, investigateCommand } from "./commands/events.js";
import { usersCommand } from "./commands/users.js";
import { authCommand } from "./commands/auth.js";
import { metricsCommand } from "./commands/metrics.js";
import { funnelsCommand } from "./commands/funnels.js";
import { auditLogCommand } from "./commands/audit-logs.js";
import { skillsCommand } from "./commands/skills.js";
import { whoamiCommand } from "./commands/whoami.js";

declare const __CLI_VERSION__: string;

const program = new Command()
  .name("owlmetry")
  .version(__CLI_VERSION__)
  .description("OwlMetry CLI — query metrics and manage your apps from the terminal")
  .addOption(
    new Option("--format <format>", "Output format")
      .choices(["table", "json", "log"])
      .default("table"),
  )
  .option("--endpoint <url>", "OwlMetry API server URL")
  .option("--api-key <key>", "API key")
  .option("--ingest-endpoint <url>", "OwlMetry ingest endpoint URL (for SDKs; defaults to API endpoint for self-hosted)");

program.addCommand(authCommand);
program.addCommand(setupCommand);
program.addCommand(projectsCommand);
program.addCommand(appsCommand);
program.addCommand(eventsCommand);
program.addCommand(investigateCommand);
program.addCommand(usersCommand);
program.addCommand(metricsCommand);
program.addCommand(funnelsCommand);
program.addCommand(auditLogCommand);
program.addCommand(skillsCommand);
program.addCommand(whoamiCommand);

program.parseAsync().catch((err: unknown) => {
  const format = program.opts().format as string;
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof ApiError ? err.status : undefined;

  if (format === "json") {
    console.error(JSON.stringify(status ? { error: message, status } : { error: message }));
  } else {
    console.error(chalk.red(status ? `API error (${status}): ${message}` : message));
  }
  process.exit(1);
});
