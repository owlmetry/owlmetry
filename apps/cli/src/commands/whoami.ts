import { Command } from "commander";
import chalk from "chalk";
import { createClient, loadConfig, listProfiles } from "../config.js";

export const whoamiCommand = new Command("whoami")
  .description("Show current authentication status and identity")
  .action(async (_opts, cmd) => {
    const { client, globals } = createClient(cmd);
    const data = await client.whoami();

    if (globals.format === "json") {
      const config = loadConfig();
      const profiles = config ? listProfiles(config) : [];
      console.log(JSON.stringify({
        ...data,
        configured_profiles: profiles.map(p => ({
          team_id: p.teamId,
          team_name: p.profile.team_name,
          team_slug: p.profile.team_slug,
          active: p.active,
        })),
      }, null, 2));
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

    // Show configured profiles
    const config = loadConfig();
    if (config && Object.keys(config.teams).length > 0) {
      const profiles = listProfiles(config);
      console.log();
      console.log("Configured profiles:");
      for (const { teamId, profile, active } of profiles) {
        const marker = active ? chalk.green("●") : " ";
        const name = active ? chalk.bold(profile.team_name) : profile.team_name;
        console.log(`  ${marker} ${name} (${profile.team_slug})    ${chalk.dim(teamId)}`);
      }
    }
  });
