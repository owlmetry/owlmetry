import { Command } from "commander";
import { createClient, loadConfig, getActiveProfile } from "../config.js";
import { output } from "../formatters/index.js";
import {
  formatProjectsTable,
  formatProjectDetail,
} from "../formatters/table.js";

export const projectsCommand = new Command("projects")
  .description("List projects")
  .action(async (_opts, cmd) => {
    const { client, globals } = createClient(cmd);
    const projects = await client.listProjects();
    output(globals.format, projects, () => formatProjectsTable(projects));
  });

projectsCommand
  .command("view <id>")
  .description("View project details")
  .action(async (id: string, _opts, cmd) => {
    const { client, globals } = createClient(cmd);
    const project = await client.getProject(id);
    output(globals.format, project, () => formatProjectDetail(project));
  });

projectsCommand
  .command("create")
  .description("Create a new project")
  .option("--team-id <id>", "Team ID (defaults to active team)")
  .requiredOption("--name <name>", "Project name")
  .requiredOption("--slug <slug>", "Project slug")
  .action(async (opts: { teamId?: string; name: string; slug: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    let teamId = opts.teamId;
    if (!teamId) {
      const config = loadConfig();
      if (!config) {
        throw new Error("No team ID specified and no config found. Use --team-id or run `owlmetry auth verify` first.");
      }
      const resolved = getActiveProfile(config, globals.team);
      teamId = resolved.teamId;
    }
    const project = await client.createProject({
      team_id: teamId,
      name: opts.name,
      slug: opts.slug,
    });
    output(globals.format, project, () => formatProjectDetail({ ...project, apps: [] }));
  });

projectsCommand
  .command("update <id>")
  .description("Update project name")
  .requiredOption("--name <name>", "New project name")
  .action(async (id: string, opts: { name: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const project = await client.updateProject(id, { name: opts.name });
    output(globals.format, project, () => formatProjectDetail({ ...project, apps: [] }));
  });
