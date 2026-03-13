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

  if (err instanceof ApiError) {
    if (format === "json") {
      console.error(JSON.stringify({ error: err.message, status: err.status }));
    } else {
      console.error(chalk.red(`API error (${err.status}): ${err.message}`));
    }
    process.exit(1);
  }

  if (err instanceof Error) {
    if (format === "json") {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(err.message));
    }
    process.exit(1);
  }

  console.error(chalk.red(String(err)));
  process.exit(1);
});
