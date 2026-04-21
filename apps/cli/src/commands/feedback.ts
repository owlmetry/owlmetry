import { Command, Option } from "commander";
import chalk from "chalk";
import type { FeedbackResponse, FeedbackDetailResponse } from "@owlmetry/shared";
import { FEEDBACK_STATUSES } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { parsePositiveInt } from "../utils/parse.js";
import { paginationHint } from "../utils/pagination.js";

function statusBadge(status: string): string {
  switch (status) {
    case "new": return chalk.red("🆕 new");
    case "in_review": return chalk.blue("👀 in_review");
    case "addressed": return chalk.green("✅ addressed");
    case "dismissed": return chalk.gray("🚫 dismissed");
    default: return status;
  }
}

function formatFeedbackTable(feedback: FeedbackResponse[]): string {
  if (feedback.length === 0) return chalk.dim("No feedback");

  const lines = [
    chalk.bold(
      "Status".padEnd(18) +
      "From".padEnd(24) +
      "App".padEnd(14) +
      "Message",
    ),
    "─".repeat(100),
  ];

  for (const fb of feedback) {
    const badge = statusBadge(fb.status);
    const badgeVisLen = badge.replace(/\x1b\[[0-9;]*m/g, "").length;
    const badgePad = badge + " ".repeat(Math.max(0, 18 - badgeVisLen));
    const from = (fb.submitter_name ?? fb.submitter_email ?? chalk.dim("anonymous")).slice(0, 22);
    const appName = (fb.app_name ?? "").slice(0, 12);
    const message = fb.message.length > 50 ? fb.message.slice(0, 47) + "..." : fb.message;
    const fromVisLen = from.replace(/\x1b\[[0-9;]*m/g, "").length;
    const fromPad = from + " ".repeat(Math.max(0, 24 - fromVisLen));
    lines.push(`${badgePad}${fromPad}${appName.padEnd(14)}${message.replace(/\n/g, " ")}`);
  }

  return lines.join("\n");
}

function formatFeedbackDetail(fb: FeedbackDetailResponse): string {
  const lines = [
    chalk.bold("Feedback"),
    "",
    `  ID:        ${fb.id}`,
    `  Status:    ${statusBadge(fb.status)}`,
    `  App:       ${fb.app_name ?? fb.app_id}`,
    `  From:      ${fb.submitter_name ?? chalk.dim("—")}${fb.submitter_email ? `  <${fb.submitter_email}>` : ""}`,
    `  Session:   ${fb.session_id ?? chalk.dim("—")}`,
    `  User:      ${fb.user_id ?? chalk.dim("anonymous")}`,
    `  Version:   ${fb.app_version ?? chalk.dim("—")}${fb.environment ? `  (${fb.environment})` : ""}`,
    `  Device:    ${fb.device_model ?? chalk.dim("—")}${fb.os_version ? `  OS ${fb.os_version}` : ""}`,
    `  Country:   ${fb.country_code ?? chalk.dim("—")}`,
    `  Dev:       ${fb.is_dev ? "🛠️ yes" : "no"}`,
    `  Created:   ${new Date(fb.created_at).toLocaleString()}`,
    `  Updated:   ${new Date(fb.updated_at).toLocaleString()}`,
    "",
    chalk.bold("  Message:"),
    ...fb.message.split("\n").map((line) => `    ${line}`),
  ];

  if (fb.comments.length > 0) {
    lines.push("", chalk.bold("  Comments:"));
    for (const c of fb.comments) {
      const authorBadge = c.author_type === "agent" ? "🕶️" : "👤";
      const ts = new Date(c.created_at).toLocaleString();
      lines.push(`    ${authorBadge} ${c.author_name} (${ts}):`);
      lines.push(`      ${c.body}`);
    }
  }

  return lines.join("\n");
}

export const feedbackCommand = new Command("feedback")
  .description("View and manage user feedback");

feedbackCommand
  .command("list")
  .description("List feedback for a project")
  .requiredOption("--project-id <id>", "Project ID")
  .addOption(
    new Option("--status <status>", "Filter by status")
      .choices([...FEEDBACK_STATUSES]),
  )
  .option("--app-id <id>", "Filter by app ID")
  .option("--dev", "Show dev feedback only")
  .addOption(
    new Option("--limit <n>", "Max entries to return")
      .argParser((v) => parsePositiveInt(v, "--limit")),
  )
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts: {
    projectId: string;
    status?: string;
    appId?: string;
    dev?: boolean;
    limit?: number;
    cursor?: string;
  }, cmd) => {
    const { client, globals } = createClient(cmd);

    const result = await client.listFeedback(opts.projectId, {
      status: opts.status,
      app_id: opts.appId,
      is_dev: opts.dev ? "true" : undefined,
      limit: opts.limit?.toString(),
      cursor: opts.cursor,
    });

    output(
      globals.format as OutputFormat,
      result,
      () => formatFeedbackTable(result.feedback) + paginationHint(result),
    );
  });

feedbackCommand
  .command("view <feedbackId>")
  .description("View feedback details")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (feedbackId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.getFeedback(opts.projectId, feedbackId);
    output(globals.format as OutputFormat, result, () => formatFeedbackDetail(result));
  });

feedbackCommand
  .command("status <feedbackId>")
  .description("Change the status of a feedback item")
  .requiredOption("--project-id <id>", "Project ID")
  .addOption(
    new Option("--to <status>", "New status")
      .choices([...FEEDBACK_STATUSES])
      .makeOptionMandatory(true),
  )
  .action(async (feedbackId: string, opts: { projectId: string; to: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.updateFeedback(opts.projectId, feedbackId, {
      status: opts.to as any,
    });
    output(globals.format as OutputFormat, result, () => chalk.green(`Status set to ${opts.to}`));
  });

feedbackCommand
  .command("comment <feedbackId>")
  .description("Add a comment to a feedback item")
  .requiredOption("--project-id <id>", "Project ID")
  .requiredOption("--body <text>", "Comment text")
  .action(async (feedbackId: string, opts: { projectId: string; body: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.addFeedbackComment(opts.projectId, feedbackId, { body: opts.body });
    output(globals.format as OutputFormat, result, () => chalk.green("Comment added"));
  });

feedbackCommand
  .command("delete <feedbackId>")
  .description("Delete a feedback item (user-only; agent keys are not allowed)")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (feedbackId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.deleteFeedback(opts.projectId, feedbackId);
    output(globals.format as OutputFormat, result, () => chalk.green("Feedback deleted"));
  });
