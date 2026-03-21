import { Command } from "commander";
import chalk from "chalk";
import { saveConfig, getGlobals } from "../config.js";
import { OwlMetryClient } from "../client.js";

export const setupCommand = new Command("setup")
  .description("Configure CLI endpoint and API key (pass --endpoint and --api-key)")
  .action(async (_opts, cmd) => {
    const globals = getGlobals(cmd);

    if (!globals.endpoint) {
      console.error(chalk.red("--endpoint is required for setup"));
      process.exit(1);
    }
    if (!globals.apiKey) {
      console.error(chalk.red("--api-key is required for setup"));
      process.exit(1);
    }

    // Validate URL
    try {
      new URL(globals.endpoint);
    } catch {
      console.error(chalk.red(`Invalid URL: ${globals.endpoint}`));
      process.exit(1);
    }

    // Verify connectivity
    const client = new OwlMetryClient({
      endpoint: globals.endpoint,
      apiKey: globals.apiKey,
    });

    try {
      await client.listProjects();
    } catch (err) {
      console.error(
        chalk.red(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }

    const ingestEndpoint = (globals as { ingestEndpoint?: string }).ingestEndpoint || globals.endpoint;
    saveConfig({ endpoint: globals.endpoint, api_key: globals.apiKey, ingest_endpoint: ingestEndpoint });
    console.log(chalk.green("Configuration saved to ~/.owlmetry/config.json"));
    console.log(`  API endpoint:     ${globals.endpoint}`);
    console.log(`  Ingest endpoint:  ${ingestEndpoint}`);
  });
