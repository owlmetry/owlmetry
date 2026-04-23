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
  .addOption(
    new Option("--order <direction>", "Sort direction by timestamp (default: desc)")
      .choices(["asc", "desc"]),
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
    order?: string;
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
      order: opts.order as "asc" | "desc" | undefined,
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
    const app = await client.getApp(event.app_id).catch(() => null);
    output(globals.format, event, () => formatEventDetail(event, app?.latest_app_version ?? null));
  });

export const investigateCommand = new Command("investigate")
  .description("Build a breadcrumb timeline around a specific event (full session + cross-app user events)")
  .argument("<eventId>", "Target event ID")
  .addOption(
    new Option("--window <minutes>", "Fallback time window in minutes, used only when the target has no session_id")
      .default(5)
      .argParser((v) => parsePositiveInt(v, "--window")),
  )
  .action(async (eventId: string, opts: { window: number }, cmd) => {
    const { client, globals } = createClient(cmd);
    const format = globals.format === "table" ? "log" as OutputFormat : globals.format;

    const target = await client.getEvent(eventId);
    const targetTime = new Date(target.timestamp).getTime();

    // Phase A: full session (same app) or ±window fallback.
    const phaseA = target.session_id
      ? await client.queryEvents({
          app_id: target.app_id,
          session_id: target.session_id,
          limit: 1000,
        })
      : await client.queryEvents({
          app_id: target.app_id,
          user_id: target.user_id ?? undefined,
          since: new Date(targetTime - opts.window * 60_000).toISOString(),
          until: new Date(targetTime + opts.window * 60_000).toISOString(),
          limit: 1000,
        });

    // Phase B: project-wide events for the same user, bounded by Phase A's time range.
    let phaseBEvents: typeof phaseA.events = [];
    if (target.user_id && target.project_id) {
      const timestamps = phaseA.events
        .map((e) => new Date(e.timestamp).getTime())
        .filter((n) => Number.isFinite(n));
      const earliestMs = timestamps.length ? Math.min(...timestamps, targetTime) : targetTime;
      const latestMs = timestamps.length ? Math.max(...timestamps, targetTime) : targetTime;

      const phaseB = await client.queryEvents({
        project_id: target.project_id,
        user_id: target.user_id,
        since: new Date(earliestMs).toISOString(),
        until: new Date(latestMs).toISOString(),
        limit: 1000,
      });
      phaseBEvents = phaseB.events;
    }

    // Merge target + Phase A + Phase B, dedupe by id, sort ascending by timestamp.
    const byId = new Map<string, typeof phaseA.events[number]>();
    for (const e of [target, ...phaseA.events, ...phaseBEvents]) {
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    const events = Array.from(byId.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const logOutput = () => formatEventsLog(events, { highlightId: eventId });
    output(format, { events, target_event_id: eventId, total: events.length }, logOutput, logOutput);
  });
