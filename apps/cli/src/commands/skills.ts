import { Command } from "commander";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";

const SKILLS = [
  { dir: "owlmetry-cli", label: "CLI" },
  { dir: "owlmetry-node", label: "Node SDK" },
  { dir: "owlmetry-swift", label: "Swift SDK" },
];

export const skillsCommand = new Command("skills")
  .description("Show paths to AI skill files bundled with this CLI")
  .action(() => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const skillsDir = resolve(__dirname, "skills");

    if (!existsSync(skillsDir)) {
      console.error(
        chalk.red("Skills directory not found. This may indicate a broken installation."),
      );
      process.exit(1);
    }

    console.log(chalk.bold("\nOwlMetry AI Skills\n"));

    const maxLabelLen = Math.max(...SKILLS.map((s) => s.label.length));

    for (const skill of SKILLS) {
      const skillPath = join(skillsDir, skill.dir, "SKILL.md");
      const label = skill.label.padEnd(maxLabelLen);
      if (existsSync(skillPath)) {
        console.log(`  ${chalk.cyan(label)}  ${skillPath}`);
      } else {
        console.log(`  ${chalk.cyan(label)}  ${chalk.dim("(not found)")}`);
      }
    }

    console.log(
      `\n${chalk.dim("Point your AI agent to these files to teach it how to use OwlMetry.")}`,
    );
  });
