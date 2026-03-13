import { Command, Option } from "commander";
import chalk from "chalk";
import { LOG_LEVELS } from "@owlmetry/shared";
import type { EventsResponse } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { formatEventsTable, formatEventDetail } from "../formatters/table.js";
import { formatEventsLog } from "../formatters/log.js";
import { parseTimeInput } from "../utils/time.js";

function paginationHint(result: EventsResponse): string {
  if (result.has_more && result.cursor) {
    return `\n${chalk.dim(`More results available. Use --cursor ${result.cursor}`)}`;
  }
  return "";
}

export const eventsCommand = new Command("events")
  .description("Query events")
  .option("--project <id>", "Filter by project ID")
  .option("--app <id>", "Filter by app ID")
  .option("--since <time>", "Start time (e.g. 1h, 30m, 7d, or ISO 8601)")
  .option("--until <time>", "End time")
  .addOption(
    new Option("--level <level>", "Filter by log level")
      .choices(LOG_LEVELS as unknown as string[]),
  )
  .option("--user <id>", "Filter by user ID")
  .option("--screen <name>", "Filter by screen name")
  .option("--limit <n>", "Max events to return")
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts: {
    project?: string;
    app?: string;
    since?: string;
    until?: string;
    level?: string;
    user?: string;
    screen?: string;
    limit?: string;
    cursor?: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    const since = opts.since
      ? parseTimeInput(opts.since)
      : !opts.until
        ? parseTimeInput("24h")
        : undefined;
    const until = opts.until ? parseTimeInput(opts.until) : undefined;

    const result = await client.queryEvents({
      project_id: opts.project,
      app_id: opts.app,
      since,
      until,
      level: opts.level,
      user_id: opts.user,
      screen_name: opts.screen,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      cursor: opts.cursor,
    });

    const hint = paginationHint(result);
    output(
      globals.format,
      result,
      () => formatEventsTable(result.events) + hint,
      () => formatEventsLog(result.events) + hint,
    );
  });

eventsCommand
  .command("view <id>")
  .description("View event details")
  .action(async (id: string, _opts, cmd) => {
    const { client, globals } = createClient(cmd);
    const event = await client.getEvent(id);
    output(globals.format, event, () => formatEventDetail(event));
  });

export const investigateCommand = new Command("investigate")
  .description("Show events surrounding a specific event")
  .argument("<eventId>", "Target event ID")
  .option("--window <minutes>", "Time window in minutes around target event", "5")
  .action(async (eventId: string, opts: { window: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const format = globals.format === "table" ? "log" as OutputFormat : globals.format;

    const target = await client.getEvent(eventId);
    const windowMs = parseInt(opts.window, 10) * 60_000;
    const targetTime = new Date(target.timestamp).getTime();

    const result = await client.queryEvents({
      app_id: target.app_id,
      user_id: target.user_id ?? undefined,
      since: new Date(targetTime - windowMs).toISOString(),
      until: new Date(targetTime + windowMs).toISOString(),
      limit: 200,
    });

    const logOutput = () => formatEventsLog(result.events, { highlightId: eventId });
    output(format, { target, context: result.events }, logOutput, logOutput);
  });
