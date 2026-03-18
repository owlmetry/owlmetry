import chalk, { type ChalkInstance } from "chalk";
import type { LogLevel, MetricPhase, StoredEventResponse, StoredMetricEventResponse } from "@owlmetry/shared";

const LEVEL_COLORS: Record<LogLevel, ChalkInstance> = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.cyan,
  debug: chalk.gray,
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export function formatEventLog(
  event: StoredEventResponse,
  opts?: { highlight?: boolean },
): string {
  const color = LEVEL_COLORS[event.level as LogLevel] ?? chalk.white;
  const prefix = opts?.highlight ? chalk.bold.white(">>> ") : "    ";
  const level = color(event.level.toUpperCase().padEnd(9));
  const time = chalk.dim(`[${formatTime(event.timestamp)}]`);
  const message = event.message;

  const meta: string[] = [];
  if (event.user_id) meta.push(`user=${event.user_id}`);
  if (event.session_id) meta.push(`session=${event.session_id.slice(0, 8)}`);
  if (event.screen_name) meta.push(`screen=${event.screen_name}`);
  const metaStr = meta.length > 0 ? chalk.dim(`  (${meta.join(", ")})`) : "";

  return `${prefix}${time} ${level} ${message}${metaStr}`;
}

export function formatEventsLog(
  events: StoredEventResponse[],
  opts?: { highlightId?: string },
): string {
  return events
    .map((e) =>
      formatEventLog(e, { highlight: e.id === opts?.highlightId }),
    )
    .join("\n");
}

const PHASE_COLORS: Record<MetricPhase, ChalkInstance> = {
  complete: chalk.green,
  fail: chalk.red,
  cancel: chalk.yellow,
  start: chalk.cyan,
  record: chalk.blue,
};

function formatMetricEventLog(event: StoredMetricEventResponse, slug: string): string {
  const color = PHASE_COLORS[event.phase as MetricPhase] ?? chalk.white;
  const time = chalk.dim(`[${formatTime(event.timestamp)}]`);
  const phase = color(event.phase.toUpperCase().padEnd(9));
  const duration = event.duration_ms != null ? chalk.white(`${event.duration_ms}ms`) : "";

  const meta: string[] = [];
  if (event.tracking_id) meta.push(`tid=${event.tracking_id.slice(0, 8)}`);
  if (event.user_id) meta.push(`user=${event.user_id}`);
  if (event.error) meta.push(`error=${event.error}`);
  const metaStr = meta.length > 0 ? chalk.dim(`  (${meta.join(", ")})`) : "";

  return `    ${time} ${phase} ${slug}  ${duration}${metaStr}`;
}

export function formatMetricEventsLog(
  events: StoredMetricEventResponse[],
  slug: string,
): string {
  if (events.length === 0) return chalk.dim("No metric events found");
  return events.map((e) => formatMetricEventLog(e, slug)).join("\n");
}
