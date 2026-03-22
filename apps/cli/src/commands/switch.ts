import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig, listProfiles, getActiveProfile } from "../config.js";
import { getGlobals } from "../config.js";

export const switchCommand = new Command("switch")
  .description("Switch active team profile or list all profiles")
  .argument("[team]", "Team ID, slug, or name to switch to")
  .action(async (teamArg: string | undefined, _opts, cmd) => {
    const globals = getGlobals(cmd);
    const config = loadConfig();

    if (!config || Object.keys(config.teams).length === 0) {
      if (globals.format === "json") {
        console.log(JSON.stringify({ error: "No team profiles configured" }));
      } else {
        console.error(chalk.red("No team profiles configured. Run `owlmetry auth verify` to add one."));
      }
      process.exit(1);
    }

    // No argument: list all profiles
    if (!teamArg) {
      const profiles = listProfiles(config);

      if (globals.format === "json") {
        console.log(JSON.stringify(profiles.map(p => ({
          team_id: p.teamId,
          team_name: p.profile.team_name,
          team_slug: p.profile.team_slug,
          active: p.active,
        })), null, 2));
        return;
      }

      for (const { teamId, profile, active } of profiles) {
        const marker = active ? chalk.green("●") : " ";
        const name = active ? chalk.bold(profile.team_name) : profile.team_name;
        console.log(`  ${marker} ${name} (${profile.team_slug})    ${chalk.dim(teamId)}`);
      }
      return;
    }

    // With argument: switch to matching profile
    const { teamId, profile } = getActiveProfile(config, teamArg);

    if (teamId === config.active_team) {
      if (globals.format === "json") {
        console.log(JSON.stringify({ team_id: teamId, team_name: profile.team_name, already_active: true }));
      } else {
        console.log(`Already on ${chalk.bold(profile.team_name)} (${profile.team_slug})`);
      }
      return;
    }

    config.active_team = teamId;
    saveConfig(config);

    if (globals.format === "json") {
      console.log(JSON.stringify({ team_id: teamId, team_name: profile.team_name, team_slug: profile.team_slug }));
    } else {
      console.log(chalk.green(`✓ Switched to ${chalk.bold(profile.team_name)} (${profile.team_slug})`));
    }
  });
