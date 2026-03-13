#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { ApiError } from "./client.js";
import { setupCommand } from "./commands/setup.js";
import { projectsCommand } from "./commands/projects.js";
import { appsCommand } from "./commands/apps.js";
import { eventsCommand, investigateCommand } from "./commands/events.js";

const program = new Command()
  .name("owlmetry")
  .version("0.1.0")
  .description("OwlMetry CLI — query metrics and manage your apps from the terminal")
  .option("--format <format>", "Output format (table, json, log)", "table")
  .option("--endpoint <url>", "OwlMetry server URL")
  .option("--api-key <key>", "API key");

program.addCommand(setupCommand);
program.addCommand(projectsCommand);
program.addCommand(appsCommand);
program.addCommand(eventsCommand);
program.addCommand(investigateCommand);

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
