import { Command, Option } from "commander";
import { createClient } from "../config.js";
import { output } from "../formatters/index.js";
import { formatAppUsersTable } from "../formatters/table.js";
import { parsePositiveInt } from "../utils/parse.js";
import { paginationHint } from "../utils/pagination.js";

const BILLING_TIERS = ["paid", "trial", "free"] as const;

function parseBillingFlag(raw: string): string {
  const tiers = new Set<string>();
  for (const part of raw.split(",")) {
    const v = part.trim().toLowerCase();
    if (!v) continue;
    if (!(BILLING_TIERS as readonly string[]).includes(v)) {
      throw new Error(`--billing: unknown tier "${v}" (expected: ${BILLING_TIERS.join(", ")})`);
    }
    tiers.add(v);
  }
  return BILLING_TIERS.filter((t) => tiers.has(t)).join(",");
}

export const usersCommand = new Command("users")
  .description("List app users")
  .argument("<app-id>", "App ID")
  .option("--anonymous", "Show only anonymous users")
  .option("--real", "Show only real (non-anonymous) users")
  .option("--search <query>", "Search by user ID")
  .option(
    "--billing <tiers>",
    "Comma-separated billing tiers to include: paid, trial, free",
    parseBillingFlag,
  )
  .addOption(
    new Option("--limit <n>", "Max users to return")
      .argParser((v) => parsePositiveInt(v, "--limit")),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (appId: string, opts: {
    anonymous?: boolean;
    real?: boolean;
    search?: string;
    billing?: string;
    limit?: number;
    cursor?: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    const is_anonymous = opts.anonymous ? "true" : opts.real ? "false" : undefined;

    const result = await client.listAppUsers(appId, {
      is_anonymous,
      search: opts.search,
      billing_status: opts.billing || undefined,
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
