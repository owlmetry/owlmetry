import { Command } from "commander";
import chalk from "chalk";

export const skillsCommand = new Command("skills")
  .description("Show how to install the OwlMetry Claude Code skills")
  .action(() => {
    console.log(chalk.bold("\nOwlMetry Claude Code skills\n"));
    console.log("  Install via the plugin marketplace inside Claude Code:");
    console.log();
    console.log(chalk.cyan("    /plugin marketplace add owlmetry/owlmetry-skills"));
    console.log(chalk.cyan("    /plugin install owlmetry@owlmetry-skills"));
    console.log();
    console.log("  Installs three skills — " + chalk.cyan("owlmetry-cli") + ", " + chalk.cyan("owlmetry-node") + ", " + chalk.cyan("owlmetry-swift") + ".");
    console.log("  Source: " + chalk.dim("https://github.com/owlmetry/owlmetry-skills"));
    console.log();
    console.log(chalk.dim("  For non–Claude Code agents, clone the repo and copy the skill folders into your"));
    console.log(chalk.dim("  agent's skills directory (for example, ~/.claude/skills/)."));
    console.log();
  });
