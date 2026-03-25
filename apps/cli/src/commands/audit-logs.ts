import { Command, Option } from "commander";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { parsePositiveInt } from "../utils/parse.js";

import { paginationHint } from "../utils/pagination.js";

export const auditLogCommand = new Command("audit-log")
  .description("View audit logs");

auditLogCommand
  .command("list")
  .description("List audit log entries")
  .requiredOption("--team-id <id>", "Team ID")
  .option("--resource-type <type>", "Filter by resource type")
  .option("--resource-id <id>", "Filter by resource ID")
  .option("--actor-id <id>", "Filter by actor ID")
  .addOption(
    new Option("--action <action>", "Filter by action")
      .choices(["create", "update", "delete"]),
  )
  .option("--since <time>", "Start time (e.g. 1h, 30m, 7d, or ISO 8601)")
  .option("--until <time>", "End time")
  .addOption(
    new Option("--limit <n>", "Max entries to return")
      .argParser((v) => parsePositiveInt(v, "--limit")),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts: {
    teamId: string;
    resourceType?: string;
    resourceId?: string;
    actorId?: string;
    action?: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    const since = opts.since;
    const until = opts.until;

    const result = await client.queryAuditLogs(opts.teamId, {
      resource_type: opts.resourceType,
      resource_id: opts.resourceId,
      actor_id: opts.actorId,
      action: opts.action,
      since,
      until,
      cursor: opts.cursor,
      limit: opts.limit,
    });

    output(
      globals.format as OutputFormat,
      result,
      () => {
        if (result.audit_logs.length === 0) return "No audit logs found.";

        const header = `${"Time".padEnd(22)} ${"Action".padEnd(8)} ${"Resource".padEnd(20)} ${"Actor".padEnd(10)} Resource ID`;
        const divider = "-".repeat(100);
        const rows = result.audit_logs.map((log) => {
          const ts = new Date(log.timestamp).toISOString().replace("T", " ").slice(0, 19);
          return `${ts.padEnd(22)} ${log.action.padEnd(8)} ${log.resource_type.padEnd(20)} ${log.actor_type.padEnd(10)} ${log.resource_id}`;
        });

        let out = [header, divider, ...rows].join("\n");
        out += paginationHint(result);
        return out;
      },
    );
  });
