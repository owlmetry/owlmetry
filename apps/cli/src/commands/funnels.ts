import { Command, Option } from "commander";
import chalk from "chalk";
import type { FunnelDefinitionResponse, FunnelQueryResponse, FunnelStepAnalytics } from "@owlmetry/shared";
import { validateFunnelSlug } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output } from "../formatters/index.js";

function formatFunnelsTable(funnels: FunnelDefinitionResponse[]): string {
  if (funnels.length === 0) return chalk.dim("No funnels defined");

  const lines = [
    chalk.bold("Slug".padEnd(30) + "Name".padEnd(30) + "Steps"),
    "\u2500".repeat(70),
  ];
  for (const f of funnels) {
    lines.push(`${f.slug.padEnd(30)}${f.name.padEnd(30)}${f.steps.length}`);
  }
  return lines.join("\n");
}

function formatFunnelDetail(funnel: FunnelDefinitionResponse): string {
  const lines = [
    chalk.bold(funnel.name),
    chalk.dim(`slug: ${funnel.slug}`),
  ];
  if (funnel.description) lines.push(`\n${funnel.description}`);

  lines.push("");
  lines.push(chalk.bold("Steps"));
  for (let i = 0; i < funnel.steps.length; i++) {
    const step = funnel.steps[i];
    const filter = step.event_filter;
    const filterParts: string[] = [];
    if (filter.message) filterParts.push(`message=${filter.message}`);
    if (filter.screen_name) filterParts.push(`screen=${filter.screen_name}`);
    lines.push(`  ${i + 1}. ${step.name}  ${chalk.dim(filterParts.join(", "))}`);
  }

  return lines.join("\n");
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatQueryResult(result: FunnelQueryResponse): string {
  const { slug, analytics } = result;
  const { funnel, mode, steps } = analytics;

  const lines = [
    chalk.bold(`Funnel: ${slug} (${mode})`),
    "",
  ];

  if (steps.length === 0) {
    lines.push(chalk.dim("No data"));
    return lines.join("\n");
  }

  // Table header
  const colStep = " Step  ";
  const colName = "Name".padEnd(20);
  const colUsers = "Users".padStart(10);
  const colPct = "% of Start".padStart(12);
  const colDrop = "Drop-off";

  lines.push(chalk.bold(` ${colStep}${colName}${colUsers}${colPct}  ${colDrop}`));

  for (const step of steps) {
    const stepNum = ` ${(step.step_index + 1).toString().padEnd(6)}`;
    const name = step.step_name.padEnd(20);
    const users = formatNumber(step.unique_users).padStart(10);
    const pct = `${step.percentage.toFixed(1)}%`.padStart(12);

    let dropOff: string;
    if (step.step_index === 0) {
      dropOff = chalk.dim("\u2014");
    } else {
      dropOff = chalk.red(`\u25BC ${formatNumber(step.drop_off_count)} (${step.drop_off_percentage.toFixed(1)}%)`);
    }

    lines.push(`${stepNum}${name}${users}${pct}  ${dropOff}`);
  }

  // Breakdown groups
  if (analytics.breakdown && analytics.breakdown.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Breakdown"));
    for (const group of analytics.breakdown) {
      lines.push("");
      lines.push(chalk.bold(`  ${group.key}: ${group.value}  (${formatNumber(group.total_users)} users)`));
      for (const step of group.steps) {
        const num = `  ${(step.step_index + 1).toString().padEnd(4)}`;
        const name = step.step_name.padEnd(18);
        const users = formatNumber(step.unique_users).padStart(8);
        const pct = `${step.percentage.toFixed(1)}%`.padStart(10);
        lines.push(`  ${num}${name}${users}${pct}`);
      }
    }
  }

  return lines.join("\n");
}

export const funnelsCommand = new Command("funnels")
  .description("List funnel definitions")
  .option("--project <id>", "Project ID")
  .action(async (opts: { project?: string }, cmd) => {
    if (!opts.project) {
      console.error(chalk.red("Error: --project is required"));
      process.exitCode = 1;
      return;
    }
    const { client, globals } = createClient(cmd);
    const result = await client.listFunnels(opts.project);
    output(globals.format, result.funnels, () => formatFunnelsTable(result.funnels));
  });

funnelsCommand
  .command("view <slug>")
  .description("View funnel definition details")
  .requiredOption("--project <id>", "Project ID")
  .action(async (slug: string, opts: { project: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const funnel = await client.getFunnel(slug, opts.project);
    output(globals.format, funnel, () => formatFunnelDetail(funnel));
  });

funnelsCommand
  .command("create")
  .description("Create a new funnel definition")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--name <name>", "Funnel name")
  .requiredOption("--slug <slug>", "Funnel slug")
  .option("--description <desc>", "Description")
  .requiredOption("--steps <json>", "Steps as JSON array")
  .action(async (opts: { project: string; name: string; slug: string; description?: string; steps: string }, cmd) => {
    const slugError = validateFunnelSlug(opts.slug);
    if (slugError) {
      console.error(chalk.red(`Error: ${slugError}`));
      process.exitCode = 1;
      return;
    }

    let steps: unknown;
    try {
      steps = JSON.parse(opts.steps);
    } catch {
      console.error(chalk.red("Error: --steps must be valid JSON"));
      process.exitCode = 1;
      return;
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      console.error(chalk.red("Error: --steps must be a non-empty JSON array"));
      process.exitCode = 1;
      return;
    }

    const { client, globals } = createClient(cmd);
    const funnel = await client.createFunnel(opts.project, {
      name: opts.name,
      slug: opts.slug,
      description: opts.description,
      steps,
    });
    output(globals.format, funnel, () => formatFunnelDetail(funnel));
  });

funnelsCommand
  .command("update <slug>")
  .description("Update a funnel definition")
  .requiredOption("--project <id>", "Project ID")
  .option("--name <name>", "New name")
  .option("--description <desc>", "New description")
  .option("--steps <json>", "New steps as JSON array")
  .action(async (slug: string, opts: { project: string; name?: string; description?: string; steps?: string }, cmd) => {
    const body: { name?: string; description?: string; steps?: unknown } = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.description !== undefined) body.description = opts.description;

    if (opts.steps !== undefined) {
      try {
        body.steps = JSON.parse(opts.steps);
      } catch {
        console.error(chalk.red("Error: --steps must be valid JSON"));
        process.exitCode = 1;
        return;
      }
      if (!Array.isArray(body.steps) || (body.steps as unknown[]).length === 0) {
        console.error(chalk.red("Error: --steps must be a non-empty JSON array"));
        process.exitCode = 1;
        return;
      }
    }

    const { client, globals } = createClient(cmd);
    const funnel = await client.updateFunnel(slug, opts.project, body as any);
    output(globals.format, funnel, () => formatFunnelDetail(funnel));
  });

funnelsCommand
  .command("delete <slug>")
  .description("Delete a funnel definition")
  .requiredOption("--project <id>", "Project ID")
  .action(async (slug: string, opts: { project: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    await client.deleteFunnel(slug, opts.project);
    console.log(chalk.green(`Funnel "${slug}" deleted.`));
  });

funnelsCommand
  .command("query <slug>")
  .description("Query funnel analytics")
  .requiredOption("--project <id>", "Project ID")
  .option("--since <date>", "Start date (ISO)")
  .option("--until <date>", "End date (ISO)")
  .option("--open", "Make this an open funnel. In an open funnel, users don't have to complete a previous step in order to be included in a subsequent step.")
  .option("--app-version <version>", "Filter by app version")
  .option("--environment <env>", "Filter by environment (ios, ipados, macos, android, web, backend)")
  .option("--experiment <name:variant>", "Filter by experiment (format: name:variant)")
  .option("--group-by <field>", "Group by: environment, app_version, or experiment:<name>")
  .addOption(
    new Option("--data-mode <mode>", "Data mode: production, development, or all")
      .choices(["production", "development", "all"])
      .default("production"),
  )
  .action(async (slug: string, opts: {
    project: string;
    since?: string;
    until?: string;
    open?: boolean;
    appVersion?: string;
    environment?: string;
    experiment?: string;
    groupBy?: string;
    dataMode: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.queryFunnel(slug, opts.project, {
      since: opts.since,
      until: opts.until,
      mode: opts.open ? "open" : "closed",
      app_version: opts.appVersion,
      environment: opts.environment,
      experiment: opts.experiment,
      group_by: opts.groupBy,
      data_mode: opts.dataMode as any,
    });
    output(globals.format, result, () => formatQueryResult(result));
  });
