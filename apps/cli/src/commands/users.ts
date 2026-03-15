import { Command, Option } from "commander";
import chalk from "chalk";
import type { AppUsersResponse } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output } from "../formatters/index.js";
import { formatAppUsersTable } from "../formatters/table.js";
import { parsePositiveInt } from "../utils/parse.js";

function paginationHint(result: AppUsersResponse): string {
  if (result.has_more && result.cursor) {
    return `\n${chalk.dim(`More results available. Use --cursor ${result.cursor}`)}`;
  }
  return "";
}

export const usersCommand = new Command("users")
  .description("List app users")
  .argument("<app-id>", "App ID")
  .option("--anonymous", "Show only anonymous users")
  .option("--real", "Show only real (non-anonymous) users")
  .option("--search <query>", "Search by user ID")
  .addOption(
    new Option("--limit <n>", "Max users to return")
      .argParser((v) => parsePositiveInt(v, "--limit")),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (appId: string, opts: {
    anonymous?: boolean;
    real?: boolean;
    search?: string;
    limit?: number;
    cursor?: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    const is_anonymous = opts.anonymous ? "true" : opts.real ? "false" : undefined;

    const result = await client.listAppUsers(appId, {
      is_anonymous,
      search: opts.search,
      limit: opts.limit,
      cursor: opts.cursor,
    });

    const hint = paginationHint(result);
    output(
      globals.format,
      result,
      () => formatAppUsersTable(result.users) + hint,
    );
  });
