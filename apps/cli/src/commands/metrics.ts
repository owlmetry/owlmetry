import { Command, Option } from "commander";
import chalk from "chalk";
import type { MetricDefinitionResponse, MetricQueryResponse } from "@owlmetry/shared";
import { METRIC_PHASES, validateMetricSlug } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output } from "../formatters/index.js";
import { formatMetricEventsTable } from "../formatters/table.js";
import { formatMetricEventsLog } from "../formatters/log.js";
import { parsePositiveInt } from "../utils/parse.js";
import { parseTimeInput } from "../utils/time.js";
import { paginationHint } from "../utils/pagination.js";

function formatMetricsTable(metrics: MetricDefinitionResponse[]): string {
  if (metrics.length === 0) return chalk.dim("No metrics defined");

  const lines = [
    chalk.bold("Slug".padEnd(30) + "Name".padEnd(30) + "Status".padEnd(10)),
    "─".repeat(70),
  ];
  for (const m of metrics) {
    const status = m.status === "active" ? chalk.green("active") : chalk.yellow("paused");
    lines.push(`${m.slug.padEnd(30)}${m.name.padEnd(30)}${status}`);
  }
  return lines.join("\n");
}

function formatMetricDetail(metric: MetricDefinitionResponse): string {
  const lines = [
    chalk.bold(metric.name),
    chalk.dim(`slug: ${metric.slug}`),
    `Status: ${metric.status === "active" ? chalk.green("active") : chalk.yellow("paused")}`,
  ];
  if (metric.description) lines.push(`\n${metric.description}`);
  if (metric.aggregation_rules) {
    lines.push(`\nAggregation: ${JSON.stringify(metric.aggregation_rules)}`);
  }
  if (metric.documentation) {
    lines.push(`\n--- Documentation ---\n${metric.documentation}`);
  }
  return lines.join("\n");
}

function formatQueryResult(result: MetricQueryResponse): string {
  const { slug, aggregation: agg } = result;
  const lines = [
    chalk.bold(`Metric: ${slug}`),
    "",
    chalk.bold("Summary"),
    `  Total events:   ${agg.total_count}`,
    `  Start:          ${agg.start_count}`,
    `  Complete:       ${agg.complete_count}`,
    `  Failed:         ${agg.fail_count}`,
    `  Cancelled:      ${agg.cancel_count}`,
    `  Record:         ${agg.record_count}`,
    `  Success rate:   ${agg.success_rate != null ? `${agg.success_rate}%` : "N/A"}`,
    `  Unique users:   ${agg.unique_users}`,
  ];

  if (agg.duration_avg_ms != null) {
    lines.push("");
    lines.push(chalk.bold("Duration"));
    lines.push(`  Average:  ${agg.duration_avg_ms}ms`);
    lines.push(`  P50:      ${agg.duration_p50_ms ?? "N/A"}ms`);
    lines.push(`  P95:      ${agg.duration_p95_ms ?? "N/A"}ms`);
    lines.push(`  P99:      ${agg.duration_p99_ms ?? "N/A"}ms`);
  }

  if (agg.error_breakdown?.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Errors"));
    for (const e of agg.error_breakdown) {
      lines.push(`  ${chalk.red(e.error)}: ${e.count}`);
    }
  }

  if (agg.groups && agg.groups.length > 0) {
    lines.push("");
    lines.push(chalk.bold(`Grouped by ${agg.groups[0].key}`));
    for (const g of agg.groups) {
      const sr = g.success_rate != null ? ` (${g.success_rate}% success)` : "";
      lines.push(`  ${g.value}: ${g.total_count} events${sr}`);
    }
  }

  return lines.join("\n");
}

export const metricsCommand = new Command("metrics")
  .description("List metric definitions")
  .requiredOption("--project <id>", "Project ID")
  .action(async (opts: { project: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const metrics = await client.listMetrics(opts.project);
    output(globals.format, metrics, () => formatMetricsTable(metrics));
  });

metricsCommand
  .command("events <slug>")
  .description("Query raw metric events for a metric")
  .requiredOption("--project <id>", "Project ID")
  .addOption(
    new Option("--phase <phase>", "Filter by phase")
      .choices(METRIC_PHASES as unknown as string[]),
  )
  .option("--tracking-id <id>", "Filter by tracking ID")
  .option("--user <id>", "Filter by user ID")
  .option("--since <time>", "Start time (e.g. 1h, 30m, 7d, or ISO 8601)")
  .option("--until <time>", "End time")
  .addOption(
    new Option("--limit <n>", "Max events to return")
      .argParser((v) => parsePositiveInt(v, "--limit")),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--environment <env>", "Filter by environment (ios, ipados, macos, android, web, backend)")
  .option("--include-debug", "Include debug events (hidden by default)")
  .action(async (slug: string, opts: {
    project: string;
    phase?: string;
    trackingId?: string;
    user?: string;
    environment?: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
    includeDebug?: boolean;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    const since = opts.since
      ? parseTimeInput(opts.since)
      : !opts.until
        ? parseTimeInput("24h")
        : undefined;
    const until = opts.until ? parseTimeInput(opts.until) : undefined;

    const result = await client.queryMetricEvents(slug, {
      project_id: opts.project,
      phase: opts.phase as any,
      tracking_id: opts.trackingId,
      user_id: opts.user,
      environment: opts.environment,
      since,
      until,
      cursor: opts.cursor,
      limit: opts.limit,
      include_debug: opts.includeDebug ? "true" : undefined,
    });

    const hint = paginationHint(result);
    output(
      globals.format,
      result,
      () => formatMetricEventsTable(result.events) + hint,
      () => formatMetricEventsLog(result.events, slug) + hint,
    );
  });

metricsCommand
  .command("view <slug>")
  .description("View metric definition details")
  .requiredOption("--project <id>", "Project ID")
  .action(async (slug: string, opts: { project: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const metric = await client.getMetric(slug, opts.project);
    output(globals.format, metric, () => formatMetricDetail(metric));
  });

metricsCommand
  .command("create")
  .description("Create a new metric definition")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--name <name>", "Metric name")
  .requiredOption("--slug <slug>", "Metric slug")
  .option("--description <desc>", "Description")
  .option("--docs <markdown>", "Documentation (markdown)")
  .option("--lifecycle", "Mark as lifecycle metric (has start/complete/fail phases)")
  .action(async (opts: { project: string; name: string; slug: string; description?: string; docs?: string; lifecycle?: boolean }, cmd) => {
    const slugError = validateMetricSlug(opts.slug);
    if (slugError) {
      console.error(chalk.red(`Error: ${slugError}`));
      process.exitCode = 1;
      return;
    }
    const { client, globals } = createClient(cmd);
    const metric = await client.createMetric({
      project_id: opts.project,
      name: opts.name,
      slug: opts.slug,
      description: opts.description,
      documentation: opts.docs,
      aggregation_rules: opts.lifecycle ? { lifecycle: true } : undefined,
    });
    output(globals.format, metric, () => formatMetricDetail(metric));
  });

metricsCommand
  .command("query <slug>")
  .description("Query metric aggregation")
  .requiredOption("--project <id>", "Project ID")
  .option("--since <date>", "Start date (ISO)")
  .option("--until <date>", "End date (ISO)")
  .option("--app <id>", "Filter by app ID")
  .option("--app-version <version>", "Filter by app version")
  .option("--device-model <model>", "Filter by device model")
  .option("--os-version <version>", "Filter by OS version")
  .option("--user <id>", "Filter by user ID")
  .option("--is-debug", "Filter to debug events only")
  .option("--environment <env>", "Filter by environment (ios, ipados, macos, android, web, backend)")
  .option("--group-by <field>", "Group by: app_id, app_version, device_model, os_version, environment, time:hour, time:day, time:week")
  .action(async (slug: string, opts: {
    project: string;
    since?: string;
    until?: string;
    app?: string;
    appVersion?: string;
    deviceModel?: string;
    osVersion?: string;
    user?: string;
    isDebug?: boolean;
    environment?: string;
    groupBy?: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.queryMetric(slug, opts.project, {
      since: opts.since,
      until: opts.until,
      app_id: opts.app,
      app_version: opts.appVersion,
      device_model: opts.deviceModel,
      os_version: opts.osVersion,
      user_id: opts.user,
      is_debug: opts.isDebug ? "true" : undefined,
      environment: opts.environment,
      group_by: opts.groupBy,
    });
    output(globals.format, result, () => formatQueryResult(result));
  });

metricsCommand
  .command("update <slug>")
  .description("Update a metric definition")
  .requiredOption("--project <id>", "Project ID")
  .option("--name <name>", "New name")
  .option("--description <desc>", "New description")
  .option("--status <status>", "active or paused")
  .action(async (slug: string, opts: { project: string; name?: string; description?: string; status?: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const metric = await client.updateMetric(slug, opts.project, {
      name: opts.name,
      description: opts.description,
      status: opts.status as "active" | "paused" | undefined,
    });
    output(globals.format, metric, () => formatMetricDetail(metric));
  });

metricsCommand
  .command("delete <slug>")
  .description("Delete a metric definition")
  .requiredOption("--project <id>", "Project ID")
  .action(async (slug: string, opts: { project: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    await client.deleteMetric(slug, opts.project);
    console.log(chalk.green(`Metric "${slug}" deleted.`));
  });
