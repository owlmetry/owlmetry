import { Command, Option } from "commander";
import chalk from "chalk";
import type { JobRunResponse } from "@owlmetry/shared";
import { JOB_TYPES, JOB_TYPE_META, formatDuration as formatMs } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { parsePositiveInt } from "../utils/parse.js";
import { paginationHint } from "../utils/pagination.js";

function statusBadge(status: string): string {
  switch (status) {
    case "completed": return chalk.green(status);
    case "failed": return chalk.red(status);
    case "running": return chalk.blue(status);
    case "cancelled": return chalk.yellow(status);
    case "pending": return chalk.gray(status);
    default: return status;
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return chalk.dim("—");
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return formatMs(end - start);
}

function formatJobRunsTable(runs: JobRunResponse[]): string {
  if (runs.length === 0) return chalk.dim("No job runs found");

  const lines = [
    chalk.bold(
      "Status".padEnd(12) +
      "Type".padEnd(24) +
      "Triggered By".padEnd(20) +
      "Duration".padEnd(12) +
      "Created",
    ),
    "─".repeat(85),
  ];

  for (const run of runs) {
    const meta = JOB_TYPE_META[run.job_type as keyof typeof JOB_TYPE_META];
    const label = meta?.label ?? run.job_type;
    const triggeredBy = run.triggered_by.startsWith("manual:") ? "manual" : run.triggered_by;
    const duration = formatDuration(run.started_at, run.completed_at);

    lines.push(
      `${statusBadge(run.status).padEnd(12 + (statusBadge(run.status).length - run.status.length))}` +
      `${label.padEnd(24)}` +
      `${triggeredBy.padEnd(20)}` +
      `${duration.padEnd(12 + (duration.length - duration.replace(/\x1b\[[0-9;]*m/g, "").length))}` +
      `${new Date(run.created_at).toLocaleString()}`,
    );
  }

  return lines.join("\n");
}

function formatJobRunDetail(run: JobRunResponse): string {
  const meta = JOB_TYPE_META[run.job_type as keyof typeof JOB_TYPE_META];
  const label = meta?.label ?? run.job_type;

  const lines = [
    chalk.bold(label),
    `  ID:          ${run.id}`,
    `  Status:      ${statusBadge(run.status)}`,
    `  Triggered:   ${run.triggered_by}`,
    `  Duration:    ${formatDuration(run.started_at, run.completed_at)}`,
    `  Created:     ${new Date(run.created_at).toLocaleString()}`,
  ];

  if (run.started_at) lines.push(`  Started:     ${new Date(run.started_at).toLocaleString()}`);
  if (run.completed_at) lines.push(`  Completed:   ${new Date(run.completed_at).toLocaleString()}`);
  if (run.team_id) lines.push(`  Team ID:     ${run.team_id}`);
  if (run.project_id) lines.push(`  Project ID:  ${run.project_id}`);

  if (run.progress) {
    const pct = run.progress.total > 0 ? Math.round((run.progress.processed / run.progress.total) * 100) : 0;
    lines.push(`  Progress:    ${run.progress.processed}/${run.progress.total} (${pct}%)`);
    if (run.progress.message) lines.push(`               ${run.progress.message}`);
  }

  if (run.error) {
    lines.push("", chalk.red("  Error:"), `  ${run.error}`);
  }

  if (run.result && Object.keys(run.result).length > 0) {
    lines.push("", chalk.bold("  Result:"));
    for (const [key, value] of Object.entries(run.result)) {
      lines.push(`    ${key}: ${JSON.stringify(value)}`);
    }
  }

  if (run.params && Object.keys(run.params).length > 0) {
    lines.push("", chalk.bold("  Params:"));
    for (const [key, value] of Object.entries(run.params)) {
      lines.push(`    ${key}: ${JSON.stringify(value)}`);
    }
  }

  return lines.join("\n");
}

export const jobsCommand = new Command("jobs")
  .description("View and manage background jobs");

jobsCommand
  .command("list")
  .description("List job runs")
  .requiredOption("--team-id <id>", "Team ID")
  .option("--type <type>", "Filter by job type")
  .option("--status <status>", "Filter by status")
  .option("--project-id <id>", "Filter by project ID")
  .option("--since <time>", "Start time (e.g. 1h, 30m, 7d, or ISO 8601)")
  .option("--until <time>", "End time")
  .addOption(
    new Option("--limit <n>", "Max entries to return")
      .argParser((v) => parsePositiveInt(v, "--limit")),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts: {
    teamId: string;
    type?: string;
    status?: string;
    projectId?: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    const result = await client.listJobRuns(opts.teamId, {
      job_type: opts.type,
      status: opts.status,
      project_id: opts.projectId,
      since: opts.since,
      until: opts.until,
      cursor: opts.cursor,
      limit: opts.limit?.toString(),
    });

    output(
      globals.format as OutputFormat,
      result,
      () => formatJobRunsTable(result.job_runs) + paginationHint(result),
    );
  });

jobsCommand
  .command("view <runId>")
  .description("View details of a job run")
  .action(async (runId: string, _, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.getJobRun(runId);
    output(globals.format as OutputFormat, result.job_run, () => formatJobRunDetail(result.job_run));
  });

jobsCommand
  .command("trigger <jobType>")
  .description("Trigger a background job")
  .requiredOption("--team-id <id>", "Team ID")
  .option("--project-id <id>", "Project ID (required for project-scoped jobs)")
  .option("--param <key=value>", "Job parameter (repeatable)", (val: string, prev: string[]) => {
    prev.push(val);
    return prev;
  }, [] as string[])
  .option("--notify", "Get email notification on completion")
  .option("--wait", "Wait for the job to finish, showing progress")
  .action(async (jobType: string, opts: {
    teamId: string;
    projectId?: string;
    param: string[];
    notify?: boolean;
    wait?: boolean;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    // Parse params from --param key=value pairs
    const params: Record<string, unknown> = {};
    for (const p of opts.param) {
      const eqIdx = p.indexOf("=");
      if (eqIdx === -1) {
        console.error(chalk.red(`Invalid param format: ${p} (expected key=value)`));
        process.exit(1);
      }
      params[p.slice(0, eqIdx)] = p.slice(eqIdx + 1);
    }

    const result = await client.triggerJob(opts.teamId, {
      job_type: jobType,
      project_id: opts.projectId,
      params: Object.keys(params).length > 0 ? params : undefined,
      notify: opts.notify,
    });

    if (!opts.wait) {
      output(globals.format as OutputFormat, result.job_run, () => {
        return `Job triggered: ${result.job_run.id}\n` +
          `Status: ${statusBadge(result.job_run.status)}\n` +
          `Use ${chalk.bold(`owlmetry jobs view ${result.job_run.id}`)} to check progress`;
      });
      return;
    }

    // Poll for completion
    const runId = result.job_run.id;
    process.stdout.write(chalk.dim("Waiting for job to complete...\n"));

    let lastStatus = result.job_run.status;
    while (lastStatus === "pending" || lastStatus === "running") {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await client.getJobRun(runId);
      lastStatus = poll.job_run.status;

      if (poll.job_run.progress) {
        const p = poll.job_run.progress;
        const pct = p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
        const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
        process.stdout.write(`\r  [${bar}] ${p.processed}/${p.total} ${p.message ?? ""}`);
      }
    }

    process.stdout.write("\n");
    const final = await client.getJobRun(runId);
    output(globals.format as OutputFormat, final.job_run, () => formatJobRunDetail(final.job_run));
  });

jobsCommand
  .command("cancel <runId>")
  .description("Cancel a running job")
  .action(async (runId: string, _, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.cancelJob(runId);
    output(globals.format as OutputFormat, result, () => chalk.green("Job cancelled successfully"));
  });
