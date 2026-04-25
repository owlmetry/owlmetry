import { Command, Option } from "commander";
import chalk from "chalk";
import { NOTIFICATION_TYPES } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { parsePositiveInt } from "../utils/parse.js";
import { paginationHint } from "../utils/pagination.js";

interface CliNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown>;
  team_id: string | null;
  read_at: string | null;
  created_at: string;
}

function formatNotificationsTable(rows: CliNotification[]): string {
  if (rows.length === 0) return chalk.dim("No notifications");

  const lines = [
    chalk.bold(
      "  ".padEnd(3) + "Type".padEnd(20) + "Title".padEnd(50) + "When",
    ),
    "─".repeat(100),
  ];

  for (const n of rows) {
    const dot = n.read_at ? chalk.dim(" ●") : chalk.red(" ●");
    const type = n.type.length > 18 ? n.type.slice(0, 17) + "…" : n.type;
    const title = n.title.length > 48 ? n.title.slice(0, 45) + "…" : n.title;
    const when = new Date(n.created_at).toLocaleString();
    lines.push(`${dot} ${type.padEnd(20)}${title.padEnd(50)}${when}`);
  }

  return lines.join("\n");
}

export const notificationsCommand = new Command("notifications").description(
  "View notifications and inbox status",
);

notificationsCommand
  .command("list")
  .description("List notifications in your inbox")
  .option("--unread", "Only show unread notifications")
  .addOption(
    new Option("--type <type>", "Filter by notification type").choices([
      ...NOTIFICATION_TYPES,
    ]),
  )
  .addOption(
    new Option("--limit <n>", "Max entries to return").argParser((v) =>
      parsePositiveInt(v, "--limit"),
    ),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .action(
    async (
      opts: { unread?: boolean; type?: string; limit?: number; cursor?: string },
      cmd,
    ) => {
      const { client, globals } = createClient(cmd);
      const result = await client.listNotifications({
        read_state: opts.unread ? "unread" : undefined,
        type: opts.type,
        limit: opts.limit,
        cursor: opts.cursor,
      });
      output(globals.format as OutputFormat, result, () =>
        formatNotificationsTable(result.notifications) + paginationHint(result),
      );
    },
  );

notificationsCommand
  .command("unread-count")
  .description("Show the unread notification count")
  .action(async (_opts, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.unreadNotificationCount();
    output(
      globals.format as OutputFormat,
      result,
      () => `${chalk.bold("Unread:")} ${result.count}`,
    );
  });

notificationsCommand
  .command("read <id>")
  .description("Mark a notification as read")
  .action(async (id: string, _opts, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.markNotificationRead(id);
    output(globals.format as OutputFormat, result, () => chalk.green("Marked read"));
  });

notificationsCommand
  .command("mark-all-read")
  .description("Mark every unread notification as read")
  .addOption(
    new Option("--type <type>", "Only mark a specific type").choices([
      ...NOTIFICATION_TYPES,
    ]),
  )
  .action(async (opts: { type?: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.markAllNotificationsRead(opts.type);
    output(
      globals.format as OutputFormat,
      result,
      () => chalk.green(`Marked ${result.marked} notification(s) as read`),
    );
  });
