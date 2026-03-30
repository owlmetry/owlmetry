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

function parseRetentionDays(value: string): number | null {
  if (value === "null" || value === "default") return null;
  const n = parseInt(value, 10);
  if (isNaN(n)) throw new Error(`Invalid retention value: ${value}`);
  return n;
}

projectsCommand
  .command("create")
  .description("Create a new project")
  .option("--team-id <id>", "Team ID (defaults to active team)")
  .requiredOption("--name <name>", "Project name")
  .requiredOption("--slug <slug>", "Project slug")
  .option("--retention-events <days>", "Days to retain events (default: 120)", parseInt)
  .option("--retention-metrics <days>", "Days to retain metric events (default: 365)", parseInt)
  .option("--retention-funnels <days>", "Days to retain funnel events (default: 365)", parseInt)
  .action(async (opts: { teamId?: string; name: string; slug: string; retentionEvents?: number; retentionMetrics?: number; retentionFunnels?: number }, cmd) => {
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
      retention_days_events: opts.retentionEvents,
      retention_days_metrics: opts.retentionMetrics,
      retention_days_funnels: opts.retentionFunnels,
    });
    output(globals.format, project, () => formatProjectDetail({ ...project, apps: [] }));
  });

projectsCommand
  .command("update <id>")
  .description("Update project name or retention policies")
  .option("--name <name>", "New project name")
  .option("--retention-events <days>", 'Days to retain events ("null" to reset to default)', parseRetentionDays)
  .option("--retention-metrics <days>", 'Days to retain metric events ("null" to reset to default)', parseRetentionDays)
  .option("--retention-funnels <days>", 'Days to retain funnel events ("null" to reset to default)', parseRetentionDays)
  .action(async (id: string, opts: { name?: string; retentionEvents?: number | null; retentionMetrics?: number | null; retentionFunnels?: number | null }, cmd) => {
    const { client, globals } = createClient(cmd);
    const body: Record<string, unknown> = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.retentionEvents !== undefined) body.retention_days_events = opts.retentionEvents;
    if (opts.retentionMetrics !== undefined) body.retention_days_metrics = opts.retentionMetrics;
    if (opts.retentionFunnels !== undefined) body.retention_days_funnels = opts.retentionFunnels;
    if (Object.keys(body).length === 0) {
      throw new Error("At least one field to update is required (--name, --retention-events, --retention-metrics, --retention-funnels)");
    }
    const project = await client.updateProject(id, body);
    output(globals.format, project, () => formatProjectDetail({ ...project, apps: [] }));
  });
