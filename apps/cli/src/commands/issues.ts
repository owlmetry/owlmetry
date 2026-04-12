import { Command, Option } from "commander";
import chalk from "chalk";
import type { IssueResponse, IssueDetailResponse, IssueCommentResponse } from "@owlmetry/shared";
import { ISSUE_STATUSES } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { parsePositiveInt } from "../utils/parse.js";
import { paginationHint } from "../utils/pagination.js";

function statusBadge(status: string): string {
  switch (status) {
    case "new": return chalk.red("🆕 new");
    case "in_progress": return chalk.blue("🔧 in_progress");
    case "resolved": return chalk.green("✅ resolved");
    case "silenced": return chalk.gray("🔇 silenced");
    case "regressed": return chalk.yellow("🔄 regressed");
    default: return status;
  }
}

function formatIssuesTable(issues: IssueResponse[]): string {
  if (issues.length === 0) return chalk.dim("No issues found");

  const lines = [
    chalk.bold(
      "Status".padEnd(18) +
      "Users".padEnd(7) +
      "Occ".padEnd(7) +
      "App".padEnd(16) +
      "Title",
    ),
    "─".repeat(90),
  ];

  for (const issue of issues) {
    const title = issue.title.length > 40 ? issue.title.slice(0, 37) + "..." : issue.title;
    const appName = (issue.app_name ?? "").slice(0, 14);
    const badge = statusBadge(issue.status);
    // Pad accounting for ANSI color codes
    const badgeVisLen = badge.replace(/\x1b\[[0-9;]*m/g, "").length;
    const badgePad = badge + " ".repeat(Math.max(0, 18 - badgeVisLen));

    lines.push(
      `${badgePad}` +
      `${String(issue.unique_user_count).padEnd(7)}` +
      `${String(issue.occurrence_count).padEnd(7)}` +
      `${appName.padEnd(16)}` +
      `${title}`,
    );
  }

  return lines.join("\n");
}

function formatIssueDetail(issue: IssueDetailResponse): string {
  const lines = [
    chalk.bold(issue.title),
    "",
    `  ID:            ${issue.id}`,
    `  Status:        ${statusBadge(issue.status)}`,
    `  App:           ${issue.app_name ?? issue.app_id}`,
    `  Source:        ${issue.source_module ?? chalk.dim("—")}`,
    `  Occurrences:   ${issue.occurrence_count}`,
    `  Unique Users:  ${issue.unique_user_count}`,
    `  Dev:           ${issue.is_dev ? "🛠️ yes" : "no"}`,
    `  First Seen:    ${new Date(issue.first_seen_at).toLocaleString()}`,
    `  Last Seen:     ${new Date(issue.last_seen_at).toLocaleString()}`,
  ];

  if (issue.resolved_at_version) {
    lines.push(`  Resolved In:   v${issue.resolved_at_version}`);
  }

  if (issue.fingerprints.length > 0) {
    lines.push("", chalk.bold("  Fingerprints:"));
    for (const fp of issue.fingerprints) {
      lines.push(`    ${chalk.dim(fp)}`);
    }
  }

  if (issue.occurrences.length > 0) {
    lines.push("", chalk.bold("  Recent Occurrences:"));
    for (const occ of issue.occurrences.slice(0, 10)) {
      const ts = new Date(occ.timestamp).toLocaleString();
      const user = occ.user_id ?? chalk.dim("anonymous");
      const version = occ.app_version ? `v${occ.app_version}` : "";
      lines.push(`    ${ts}  ${user}  ${version}  session:${occ.session_id.slice(0, 8)}…`);
    }
    if (issue.occurrence_has_more) {
      lines.push(chalk.dim(`    ... and more`));
    }
  }

  if (issue.comments.length > 0) {
    lines.push("", chalk.bold("  Comments:"));
    for (const c of issue.comments) {
      const authorBadge = c.author_type === "agent" ? "🕶️" : "👤";
      const ts = new Date(c.created_at).toLocaleString();
      lines.push(`    ${authorBadge} ${c.author_name} (${ts}):`);
      lines.push(`      ${c.body}`);
    }
  }

  return lines.join("\n");
}

export const issuesCommand = new Command("issues")
  .description("View and manage error issues");

issuesCommand
  .command("list")
  .description("List issues for a project")
  .requiredOption("--project-id <id>", "Project ID")
  .addOption(
    new Option("--status <status>", "Filter by status")
      .choices(ISSUE_STATUSES),
  )
  .option("--app-id <id>", "Filter by app ID")
  .option("--dev", "Show dev issues only")
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

    const result = await client.listIssues(opts.projectId, {
      status: opts.status,
      app_id: opts.appId,
      is_dev: opts.dev ? "true" : undefined,
      limit: opts.limit?.toString(),
      cursor: opts.cursor,
    });

    output(
      globals.format as OutputFormat,
      result,
      () => formatIssuesTable(result.issues) + paginationHint(result),
    );
  });

issuesCommand
  .command("view <issueId>")
  .description("View issue details")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (issueId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.getIssue(opts.projectId, issueId);
    output(globals.format as OutputFormat, result, () => formatIssueDetail(result));
  });

issuesCommand
  .command("resolve <issueId>")
  .description("Resolve an issue")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--version <v>", "App version where the fix was applied")
  .action(async (issueId: string, opts: { projectId: string; version?: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.updateIssue(opts.projectId, issueId, {
      status: "resolved",
      resolved_at_version: opts.version,
    });
    output(globals.format as OutputFormat, result, () => chalk.green(`Issue resolved${opts.version ? ` in v${opts.version}` : ""}`));
  });

issuesCommand
  .command("silence <issueId>")
  .description("Silence an issue (stop notifications)")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (issueId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.updateIssue(opts.projectId, issueId, { status: "silenced" });
    output(globals.format as OutputFormat, result, () => chalk.green("Issue silenced"));
  });

issuesCommand
  .command("reopen <issueId>")
  .description("Reopen a resolved or silenced issue")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (issueId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.updateIssue(opts.projectId, issueId, { status: "new" });
    output(globals.format as OutputFormat, result, () => chalk.green("Issue reopened"));
  });

issuesCommand
  .command("claim <issueId>")
  .description("Claim an issue (set to in progress)")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (issueId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.updateIssue(opts.projectId, issueId, { status: "in_progress" });
    output(globals.format as OutputFormat, result, () => chalk.green("Issue claimed (in progress)"));
  });

issuesCommand
  .command("merge <targetIssueId>")
  .description("Merge a source issue into the target issue")
  .requiredOption("--project-id <id>", "Project ID")
  .requiredOption("--source <sourceIssueId>", "Source issue ID to merge from")
  .action(async (targetIssueId: string, opts: { projectId: string; source: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.mergeIssues(opts.projectId, targetIssueId, {
      source_issue_id: opts.source,
    });
    output(globals.format as OutputFormat, result, () => chalk.green(`Issues merged. Surviving issue: ${targetIssueId}`));
  });

issuesCommand
  .command("comment <issueId>")
  .description("Add a comment to an issue")
  .requiredOption("--project-id <id>", "Project ID")
  .requiredOption("--body <text>", "Comment text")
  .action(async (issueId: string, opts: { projectId: string; body: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.addIssueComment(opts.projectId, issueId, { body: opts.body });
    output(globals.format as OutputFormat, result, () => chalk.green("Comment added"));
  });

issuesCommand
  .command("comments <issueId>")
  .description("List comments on an issue")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (issueId: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.listIssueComments(opts.projectId, issueId);

    output(globals.format as OutputFormat, result, () => {
      if (result.comments.length === 0) return chalk.dim("No comments");
      return result.comments.map((c: IssueCommentResponse) => {
        const authorBadge = c.author_type === "agent" ? "🕶️" : "👤";
        const ts = new Date(c.created_at).toLocaleString();
        return `${authorBadge} ${c.author_name} (${ts}):\n  ${c.body}`;
      }).join("\n\n");
    });
  });
