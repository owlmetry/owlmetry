import { Command, Option } from "commander";
import chalk from "chalk";
import type { ReviewResponse } from "@owlmetry/shared";
import { REVIEW_STORES, countryName, countryFlag } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { parsePositiveInt } from "../utils/parse.js";
import { paginationHint } from "../utils/pagination.js";

function stars(rating: number): string {
  const full = Math.max(0, Math.min(5, rating));
  return chalk.yellow("★".repeat(full)) + chalk.gray("★".repeat(5 - full));
}

function storeBadge(store: string): string {
  switch (store) {
    case "app_store": return chalk.cyan("🍎 App Store");
    case "play_store": return chalk.green("🤖 Play Store");
    default: return store;
  }
}

function formatReviewsTable(reviews: ReviewResponse[]): string {
  if (reviews.length === 0) return chalk.dim("No reviews");

  const lines = [
    chalk.bold(
      "Rating".padEnd(12) +
      "Country".padEnd(20) +
      "App".padEnd(14) +
      "Version".padEnd(10) +
      "Title / Body",
    ),
    "─".repeat(110),
  ];

  for (const r of reviews) {
    const rating = stars(r.rating);
    const ratingVis = rating.replace(/\x1b\[[0-9;]*m/g, "").length;
    const ratingPad = rating + " ".repeat(Math.max(0, 12 - ratingVis));
    const country = `${countryFlag(r.country_code)} ${countryName(r.country_code)}`.slice(0, 18);
    const app = (r.app_name ?? "").slice(0, 12);
    const version = (r.app_version ?? chalk.dim("—")).slice(0, 9);
    const versionVis = version.replace(/\x1b\[[0-9;]*m/g, "").length;
    const versionPad = version + " ".repeat(Math.max(0, 10 - versionVis));
    const titleOrBody = (r.title ?? r.body).replace(/\n/g, " ");
    const text = titleOrBody.length > 60 ? titleOrBody.slice(0, 57) + "..." : titleOrBody;
    lines.push(`${ratingPad}${country.padEnd(20)}${app.padEnd(14)}${versionPad}${text}`);
  }

  return lines.join("\n");
}

function formatReviewDetail(r: ReviewResponse): string {
  const lines = [
    chalk.bold("Review"),
    "",
    `  ID:        ${r.id}`,
    `  Store:     ${storeBadge(r.store)}`,
    `  Rating:    ${stars(r.rating)}  (${r.rating}/5)`,
    `  App:       ${r.app_name}`,
    `  Reviewer:  ${r.reviewer_name ?? chalk.dim("—")}`,
    `  Country:   ${countryFlag(r.country_code)} ${countryName(r.country_code)}`,
    `  Version:   ${r.app_version ?? chalk.dim("—")}`,
    `  Posted:    ${new Date(r.created_at_in_store).toLocaleString()}`,
    `  Ingested:  ${new Date(r.ingested_at).toLocaleString()}`,
  ];
  if (r.title) {
    lines.push("", chalk.bold("  Title:"), `    ${r.title}`);
  }
  lines.push("", chalk.bold("  Body:"), ...r.body.split("\n").map((line) => `    ${line}`));
  if (r.developer_response) {
    lines.push(
      "",
      chalk.bold("  Developer response:") +
        (r.developer_response_at ? chalk.dim(`  (${new Date(r.developer_response_at).toLocaleString()})`) : ""),
      ...r.developer_response.split("\n").map((line) => `    ${line}`),
    );
  }
  return lines.join("\n");
}

export const reviewsCommand = new Command("reviews")
  .description("View public App Store / Play Store reviews");

reviewsCommand
  .command("list")
  .description("List store reviews for a project")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--app-id <id>", "Filter by app ID")
  .addOption(
    new Option("--store <store>", "Filter by store").choices([...REVIEW_STORES]),
  )
  .option("--rating <n>", "Exact rating (1-5)", (v) => parsePositiveInt(v, "--rating"))
  .option("--rating-lte <n>", "Rating <= this value", (v) => parsePositiveInt(v, "--rating-lte"))
  .option("--rating-gte <n>", "Rating >= this value", (v) => parsePositiveInt(v, "--rating-gte"))
  .option("--country <cc>", "ISO country code (e.g. us, gb)")
  .option("--has-response", "Only reviews with a developer response")
  .option("--no-response", "Only reviews without a developer response")
  .option("--search <text>", "Free-text search within title + body")
  .option(
    "--limit <n>",
    "Max entries to return",
    (v) => parsePositiveInt(v, "--limit"),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts: {
    projectId: string;
    appId?: string;
    store?: string;
    rating?: number;
    ratingLte?: number;
    ratingGte?: number;
    country?: string;
    hasResponse?: boolean;
    response?: boolean;
    search?: string;
    limit?: number;
    cursor?: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);
    const hasDevResponse =
      opts.hasResponse ? true : opts.response === false ? false : undefined;
    const result = await client.listReviews(opts.projectId, {
      app_id: opts.appId,
      store: opts.store as ("app_store" | "play_store") | undefined,
      rating: opts.rating,
      rating_lte: opts.ratingLte,
      rating_gte: opts.ratingGte,
      country_code: opts.country?.toLowerCase(),
      has_developer_response: hasDevResponse,
      search: opts.search,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    output(
      globals.format as OutputFormat,
      result,
      () => formatReviewsTable(result.reviews) + paginationHint(result),
    );
  });

reviewsCommand
  .command("view <reviewId>")
  .description("View a single review's full details")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (reviewId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.getReview(opts.projectId, reviewId);
    output(globals.format as OutputFormat, result, () => formatReviewDetail(result));
  });

reviewsCommand
  .command("by-country")
  .description("Aggregate review count + average rating per country")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--app-id <id>", "Scope to a single app")
  .addOption(
    new Option("--store <store>", "Scope to a single store").choices([...REVIEW_STORES]),
  )
  .action(async (opts: { projectId: string; appId?: string; store?: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.listReviewsByCountry(opts.projectId, {
      app_id: opts.appId,
      store: opts.store,
    });
    output(globals.format as OutputFormat, result, () => {
      if (result.countries.length === 0) return chalk.dim("No reviews yet");
      const lines = [
        chalk.bold("Country".padEnd(28) + "Reviews".padEnd(12) + "Avg rating"),
        "─".repeat(60),
      ];
      for (const c of result.countries) {
        const country = `${countryFlag(c.country_code)} ${countryName(c.country_code)}`;
        lines.push(
          country.padEnd(28) +
            String(c.review_count).padEnd(12) +
            stars(Math.round(c.average_rating)) + "  " +
            chalk.dim(c.average_rating.toFixed(2)),
        );
      }
      return lines.join("\n");
    });
  });

reviewsCommand
  .command("delete <reviewId>")
  .description("Delete (hide) a review (user-only; agent keys are not allowed)")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (reviewId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.deleteReview(opts.projectId, reviewId);
    output(globals.format as OutputFormat, result, () => chalk.green("Review deleted"));
  });
