import { Command, Option } from "commander";
import { LOG_LEVELS } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { formatEventsTable, formatEventDetail } from "../formatters/table.js";
import { formatEventsLog } from "../formatters/log.js";
import { parsePositiveInt } from "../utils/parse.js";

import { paginationHint } from "../utils/pagination.js";

export const eventsCommand = new Command("events")
  .description("Query events")
  .option("--project-id <id>", "Filter by project ID")
  .option("--app-id <id>", "Filter by app ID")
  .option("--since <time>", "Start time (e.g. 1h, 30m, 7d, or ISO 8601)")
  .option("--until <time>", "End time")
  .addOption(
    new Option("--level <level>", "Filter by log level")
      .choices(LOG_LEVELS as unknown as string[]),
  )
  .option("--user-id <id>", "Filter by user ID")
  .option("--session-id <id>", "Filter by session ID")
  .option("--screen-name <name>", "Filter by screen name")
  .addOption(
    new Option("--limit <n>", "Max events to return")
      .argParser((v) => parsePositiveInt(v, "--limit")),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .addOption(
    new Option("--data-mode <mode>", "Data mode: production, development, or all")
      .choices(["production", "development", "all"])
      .default("production"),
  )
  .action(async (opts: {
    projectId?: string;
    appId?: string;
    since?: string;
    until?: string;
    level?: string;
    userId?: string;
    sessionId?: string;
    screenName?: string;
    limit?: number;
    cursor?: string;
    dataMode: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    const since = opts.since ?? (!opts.until ? "24h" : undefined);
    const until = opts.until;

    const result = await client.queryEvents({
      project_id: opts.projectId,
      app_id: opts.appId,
      since,
      until,
      level: opts.level,
      user_id: opts.userId,
      session_id: opts.sessionId,
      screen_name: opts.screenName,
      limit: opts.limit,
      cursor: opts.cursor,
      data_mode: opts.dataMode as any,
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
  .addOption(
    new Option("--window <minutes>", "Time window in minutes around target event")
      .default(5)
      .argParser((v) => parsePositiveInt(v, "--window")),
  )
  .action(async (eventId: string, opts: { window: number }, cmd) => {
    const { client, globals } = createClient(cmd);
    const format = globals.format === "table" ? "log" as OutputFormat : globals.format;

    const target = await client.getEvent(eventId);
    const windowMs = opts.window * 60_000;
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
