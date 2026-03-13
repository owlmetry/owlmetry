import { Command } from "commander";
import chalk from "chalk";
import { saveConfig } from "../config.js";
import { OwlMetryClient } from "../client.js";

export const setupCommand = new Command("setup")
  .description("Configure CLI endpoint and API key")
  .requiredOption("--endpoint <url>", "OwlMetry server URL")
  .requiredOption("--api-key <key>", "API key (agent key)")
  .action(async (opts: { endpoint: string; apiKey: string }) => {
    // Validate URL
    try {
      new URL(opts.endpoint);
    } catch {
      console.error(chalk.red(`Invalid URL: ${opts.endpoint}`));
      process.exit(1);
    }

    // Verify connectivity
    const client = new OwlMetryClient({
      endpoint: opts.endpoint,
      apiKey: opts.apiKey,
    });

    try {
      await client.listProjects();
    } catch (err) {
      console.error(
        chalk.red(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }

    saveConfig({ endpoint: opts.endpoint, api_key: opts.apiKey });
    console.log(chalk.green("Configuration saved to ~/.owlmetry/config.json"));
  });
