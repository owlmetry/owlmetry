import { Command, Option } from "commander";
import { BILLING_TIERS, type BillingTier, serializeBillingTiers } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output } from "../formatters/index.js";
import { formatAppUsersTable } from "../formatters/table.js";
import { parsePositiveInt } from "../utils/parse.js";
import { paginationHint } from "../utils/pagination.js";

function parseBillingFlag(raw: string): string {
  const tiers = new Set<BillingTier>();
  for (const part of raw.split(",")) {
    const v = part.trim().toLowerCase();
    if (!v) continue;
    if (!(BILLING_TIERS as readonly string[]).includes(v)) {
      throw new Error(`--billing: unknown tier "${v}" (expected: ${BILLING_TIERS.join(", ")})`);
    }
    tiers.add(v as BillingTier);
  }
  return serializeBillingTiers(tiers);
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

    const usersPromise = client.listAppUsers(appId, {
      is_anonymous,
      search: opts.search,
      billing_status: opts.billing || undefined,
      limit: opts.limit,
      cursor: opts.cursor,
    });

    if (globals.format === "json") {
      const result = await usersPromise;
      output(globals.format, result, () => "");
      return;
    }

    const [result, app] = await Promise.all([
      usersPromise,
      client.getApp(appId).catch(() => null),
    ]);

    const hint = paginationHint(result);
    output(
      globals.format,
      result,
      () => formatAppUsersTable(result.users, app?.latest_app_version ?? null) + hint,
    );
  });
