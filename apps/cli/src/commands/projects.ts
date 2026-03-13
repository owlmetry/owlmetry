import { Command } from "commander";
import { createClient } from "../config.js";
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
  .requiredOption("--team-id <id>", "Team ID")
  .requiredOption("--name <name>", "Project name")
  .requiredOption("--slug <slug>", "Project slug")
  .action(async (opts: { teamId: string; name: string; slug: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const project = await client.createProject({
      team_id: opts.teamId,
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
