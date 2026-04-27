import { Command, Option } from "commander";
import chalk from "chalk";
import { REVIEW_STORES, countryName, countryFlag } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { stars } from "../utils/stars.js";

export const ratingsCommand = new Command("ratings")
  .description("View per-country App Store rating aggregates (incl. star-only ratings)");

ratingsCommand
  .command("list <appId>")
  .description("List per-country ratings for an app + worldwide summary")
  .requiredOption("--project-id <id>", "Project ID")
  .addOption(new Option("--store <store>", "Store").choices([...REVIEW_STORES]))
  .action(async (appId: string, opts: { projectId: string; store?: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.listAppRatings(opts.projectId, appId, { store: opts.store });
    output(globals.format as OutputFormat, result, () => {
      const lines: string[] = [];
      const s = result.summary;
      lines.push(chalk.bold("Worldwide"));
      if (s.worldwide_average !== null && s.worldwide_count > 0) {
        lines.push(
          `  ${stars(s.worldwide_average)}  ${s.worldwide_average.toFixed(2)}  ` +
            chalk.dim(`(${s.worldwide_count.toLocaleString()} ratings)`),
        );
        if (s.current_version_average !== null) {
          lines.push(
            `  Current version: ${s.current_version_average.toFixed(2)} ★  ` +
              chalk.dim(`(${(s.current_version_count ?? 0).toLocaleString()} ratings)`),
          );
        }
      } else {
        lines.push(chalk.dim("  No ratings synced yet"));
      }
      lines.push(
        s.synced_at ? chalk.dim(`  Last synced: ${new Date(s.synced_at).toLocaleString()}`) : "",
        "",
        chalk.bold("By country"),
        "─".repeat(60),
      );
      if (result.ratings.length === 0) {
        lines.push(chalk.dim("  No country breakdowns yet"));
      } else {
        lines.push(chalk.bold("Country".padEnd(28) + "Avg".padEnd(8) + "Count"));
        for (const r of result.ratings) {
          const country = `${countryFlag(r.country_code)} ${countryName(r.country_code)}`;
          const avg = r.average_rating !== null ? r.average_rating.toFixed(2) : "—";
          lines.push(country.padEnd(28) + avg.padEnd(8) + r.rating_count.toLocaleString());
        }
      }
      return lines.join("\n");
    });
  });

ratingsCommand
  .command("by-country")
  .description("Aggregate per-country ratings across every app in a project")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--app-id <id>", "Scope to a single app")
  .addOption(new Option("--store <store>", "Store").choices([...REVIEW_STORES]))
  .action(async (opts: { projectId: string; appId?: string; store?: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.listRatingsByCountry(opts.projectId, {
      app_id: opts.appId,
      store: opts.store,
    });
    output(globals.format as OutputFormat, result, () => {
      if (result.countries.length === 0) return chalk.dim("No ratings synced yet");
      const lines = [
        chalk.bold("Country".padEnd(28) + "Ratings".padEnd(12) + "Avg"),
        "─".repeat(60),
      ];
      for (const c of result.countries) {
        const country = `${countryFlag(c.country_code)} ${countryName(c.country_code)}`;
        lines.push(
          country.padEnd(28) +
            c.rating_count.toLocaleString().padEnd(12) +
            stars(c.average_rating) + "  " +
            chalk.dim(c.average_rating.toFixed(2)),
        );
      }
      return lines.join("\n");
    });
  });

ratingsCommand
  .command("sync")
  .description("Trigger a manual ratings sync for the project (admin only)")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.syncRatings(opts.projectId);
    output(globals.format as OutputFormat, result, () => {
      if (!result.syncing) return chalk.dim("No Apple apps with bundle_id in this project");
      return chalk.green(`Sync queued for ${result.total} app(s). job_run_id: ${result.job_run_id ?? "—"}`);
    });
  });
