import { Command } from "commander";
import chalk from "chalk";
import { LOG_LEVELS } from "@owlmetry/shared";
import { resolveConfig } from "../config.js";
import { OwlMetryClient } from "../client.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { formatEventsTable, formatEventDetail } from "../formatters/table.js";
import { formatEventsLog } from "../formatters/log.js";
import { parseTimeInput } from "../utils/time.js";

export const eventsCommand = new Command("events")
  .description("Query events")
  .option("--project <id>", "Filter by project ID")
  .option("--app <id>", "Filter by app ID")
  .option("--since <time>", "Start time (e.g. 1h, 30m, 7d, or ISO 8601)")
  .option("--until <time>", "End time")
  .option("--level <level>", "Filter by log level")
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
    if (opts.level && !LOG_LEVELS.includes(opts.level as typeof LOG_LEVELS[number])) {
      console.error(chalk.red(`Invalid level: ${opts.level}. Valid: ${LOG_LEVELS.join(", ")}`));
      process.exit(1);
    }

    const globals = cmd.optsWithGlobals() as { format: OutputFormat; endpoint?: string; apiKey?: string };
    const config = resolveConfig(globals);
    const client = new OwlMetryClient({ endpoint: config.endpoint, apiKey: config.api_key });

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

    output(
      globals.format,
      result,
      () => {
        let out = formatEventsTable(result.events);
        if (result.has_more && result.cursor) {
          out += `\n${chalk.dim(`More results available. Use --cursor ${result.cursor}`)}`;
        }
        return out;
      },
      () => {
        let out = formatEventsLog(result.events);
        if (result.has_more && result.cursor) {
          out += `\n${chalk.dim(`More results available. Use --cursor ${result.cursor}`)}`;
        }
        return out;
      },
    );
  });

eventsCommand
  .command("view <id>")
  .description("View event details")
  .action(async (id: string, _opts, cmd) => {
    const globals = cmd.optsWithGlobals() as { format: OutputFormat; endpoint?: string; apiKey?: string };
    const config = resolveConfig(globals);
    const client = new OwlMetryClient({ endpoint: config.endpoint, apiKey: config.api_key });

    const event = await client.getEvent(id);
    output(globals.format, event, () => formatEventDetail(event));
  });

export const investigateCommand = new Command("investigate")
  .description("Show events surrounding a specific event")
  .argument("<eventId>", "Target event ID")
  .option("--window <minutes>", "Time window in minutes around target event", "5")
  .action(async (eventId: string, opts: { window: string }, cmd) => {
    const globals = cmd.optsWithGlobals() as { format: OutputFormat; endpoint?: string; apiKey?: string };
    const format = globals.format === "table" ? "log" as OutputFormat : globals.format;
    const config = resolveConfig(globals);
    const client = new OwlMetryClient({ endpoint: config.endpoint, apiKey: config.api_key });

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

    output(
      format,
      { target, context: result.events },
      () => formatEventsLog(result.events, { highlightId: eventId }),
      () => formatEventsLog(result.events, { highlightId: eventId }),
    );
  });
