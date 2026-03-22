import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig, getGlobals } from "../config.js";
import type { CliConfig } from "../config.js";
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

    // Verify connectivity and fetch team info
    const client = new OwlMetryClient({
      endpoint: globals.endpoint,
      apiKey: globals.apiKey,
    });

    let teamId = "_manual";
    let teamName = "Manual Setup";
    let teamSlug = "manual";

    try {
      const whoami = await client.whoami() as {
        type: string;
        team?: { id: string; name: string; slug: string };
      };

      if (whoami.team) {
        teamId = whoami.team.id;
        teamName = whoami.team.name;
        teamSlug = whoami.team.slug;
      }
    } catch (err) {
      console.error(
        chalk.red(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }

    const ingestEndpoint = (globals as { ingestEndpoint?: string }).ingestEndpoint || globals.endpoint;

    // Merge into existing config, preserving other team profiles
    const existing = loadConfig();
    const config: CliConfig = {
      endpoint: globals.endpoint,
      ingest_endpoint: ingestEndpoint,
      active_team: teamId,
      teams: {
        ...existing?.teams,
        [teamId]: {
          api_key: globals.apiKey,
          team_name: teamName,
          team_slug: teamSlug,
        },
      },
    };
    saveConfig(config);

    console.log(chalk.green("✓ Configuration saved to ~/.owlmetry/config.json"));
    console.log(`  Team:             ${teamName}`);
    console.log(`  API endpoint:     ${globals.endpoint}`);
    console.log(`  Ingest endpoint:  ${ingestEndpoint}`);
  });
