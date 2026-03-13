import chalk, { type ChalkInstance } from "chalk";
import type { StoredEventResponse } from "@owlmetry/shared";

const LEVEL_COLORS: Record<string, ChalkInstance> = {
  error: chalk.red,
  warn: chalk.yellow,
  attention: chalk.magenta,
  info: chalk.cyan,
  debug: chalk.gray,
  tracking: chalk.green,
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export function formatEventLog(
  event: StoredEventResponse,
  opts?: { highlight?: boolean },
): string {
  const color = LEVEL_COLORS[event.level] ?? chalk.white;
  const prefix = opts?.highlight ? chalk.bold.white(">>> ") : "    ";
  const level = color(event.level.toUpperCase().padEnd(9));
  const time = chalk.dim(`[${formatTime(event.timestamp)}]`);
  const message = event.message;

  const meta: string[] = [];
  if (event.user_id) meta.push(`user=${event.user_id}`);
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
