import { Command } from "commander";
import chalk from "chalk";
import { createClient } from "../config.js";

export const whoamiCommand = new Command("whoami")
  .description("Show current authentication status and identity")
  .action(async (_opts, cmd) => {
    const { client, globals } = createClient(cmd);
    const data = await client.whoami();

    if (globals.format === "json") {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (data.type === "api_key") {
      const team = data.team as { name: string } | null;
      const permissions = data.permissions as string[];
      console.log(chalk.green("✓ Authenticated"));
      console.log(`  Team:        ${team?.name ?? "unknown"}`);
      console.log(`  Key type:    ${data.key_type}`);
      console.log(`  Permissions: ${permissions.join(", ")}`);
    } else {
      const teams = data.teams as Array<{ name: string; role: string }>;
      console.log(chalk.green("✓ Authenticated"));
      console.log(`  Email: ${data.email}`);
      console.log(`  Teams: ${teams.map((t) => `${t.name} (${t.role})`).join(", ")}`);
    }
  });
