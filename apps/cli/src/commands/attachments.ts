import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import type { AttachmentSummary } from "@owlmetry/shared";
import { formatBytes, ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output } from "../formatters/index.js";
import { parsePositiveInt } from "../utils/parse.js";

function formatAttachmentsTable(rows: AttachmentSummary[]): string {
  if (rows.length === 0) return chalk.dim("No attachments found");
  const lines = [
    chalk.bold(
      "ID".padEnd(38) +
        "Size".padEnd(12) +
        "Type".padEnd(28) +
        "Filename"
    ),
    "─".repeat(110),
  ];
  for (const row of rows) {
    const id = row.id.slice(0, 36);
    lines.push(
      `${id.padEnd(38)}` +
        `${formatBytes(row.size_bytes).padEnd(12)}` +
        `${row.content_type.slice(0, 26).padEnd(28)}` +
        `${row.original_filename}`
    );
  }
  return lines.join("\n");
}

export const attachmentsCommand = new Command("attachments")
  .description("Inspect and download event attachments (files uploaded by SDKs alongside errors)");

attachmentsCommand
  .command("list")
  .description("List attachments. Filter by project, event, event_client_id, or issue.")
  .option("--project <id>", "Filter by project id")
  .option("--event <id>", "Filter by event id")
  .option("--event-client-id <id>", "Filter by SDK-generated client_event_id")
  .option("--issue <id>", "Filter by issue id")
  .option("--cursor <cursor>", "Pagination cursor from previous response")
  .option("--limit <n>", "Max results (default 50, max 200)", (v) => parsePositiveInt(v, "--limit"))
  .action(async function (this: Command) {
    const { client, globals } = createClient(this);
    const opts = this.opts<{
      project?: string;
      event?: string;
      eventClientId?: string;
      issue?: string;
      cursor?: string;
      limit?: number;
    }>();
    const result = await client.listAttachments({
      project_id: opts.project,
      event_id: opts.event,
      event_client_id: opts.eventClientId,
      issue_id: opts.issue,
      cursor: opts.cursor,
      limit: opts.limit,
    });
    output(globals.format, result, () => formatAttachmentsTable(result.attachments));
  });

attachmentsCommand
  .command("show")
  .description("Show an attachment's metadata and generate a short-lived download URL.")
  .argument("<id>", "Attachment id")
  .action(async function (this: Command, id: string) {
    const { client, globals } = createClient(this);
    const result = await client.getAttachment(id);
    output(globals.format, result, () => {
      const lines = [
        chalk.bold(result.original_filename),
        "",
        `  ID:            ${result.id}`,
        `  Size:          ${formatBytes(result.size_bytes)}`,
        `  Content type:  ${result.content_type}`,
        `  SHA-256:       ${result.sha256}`,
        `  Project:       ${result.project_id}`,
        `  App:           ${result.app_id}`,
        `  Event:         ${result.event_id ?? chalk.dim("—")}`,
        `  Issue:         ${result.issue_id ?? chalk.dim("—")}`,
        `  Uploaded at:   ${result.uploaded_at ?? chalk.dim("pending")}`,
      ];
      if (result.download_url) {
        lines.push("", chalk.bold(`  Download URL (expires in ${ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS}s):`));
        lines.push(`    ${result.download_url.url}`);
      }
      return lines.join("\n");
    });
  });

attachmentsCommand
  .command("download")
  .description("Download an attachment's bytes to a local file.")
  .argument("<id>", "Attachment id")
  .option("--out <path>", "Output file path (defaults to the original filename in cwd)")
  .action(async function (this: Command, id: string) {
    const { client, globals } = createClient(this);
    const opts = this.opts<{ out?: string }>();
    const meta = await client.getAttachment(id);
    if (!meta.download_url) {
      throw new Error("Attachment has not finished uploading yet");
    }
    const bytes = await client.downloadAttachmentBytes(meta.download_url.url);
    const target = opts.out ?? meta.original_filename;
    writeFileSync(target, bytes);
    output(
      globals.format,
      { ok: true, path: target, size_bytes: bytes.length },
      () => `Wrote ${formatBytes(bytes.length)} to ${target}`
    );
  });

attachmentsCommand
  .command("delete")
  .description("Soft-delete an attachment. Free space is reclaimed by the cleanup job.")
  .argument("<id>", "Attachment id")
  .action(async function (this: Command, id: string) {
    const { client, globals } = createClient(this);
    const result = await client.deleteAttachment(id);
    output(globals.format, result, () => "Attachment deleted");
  });

attachmentsCommand
  .command("usage")
  .description("Show a project's attachment storage usage against its quota.")
  .requiredOption("--project <id>", "Project id")
  .action(async function (this: Command) {
    const { client, globals } = createClient(this);
    const opts = this.opts<{ project: string }>();
    const usage = await client.getAttachmentUsage(opts.project);
    output(globals.format, usage, () => {
      const pct = usage.quota_bytes === 0 ? 0 : (usage.used_bytes / usage.quota_bytes) * 100;
      return [
        chalk.bold(`Attachment usage for project ${usage.project_id}`),
        "",
        `  Files:            ${usage.file_count}`,
        `  Used:             ${formatBytes(usage.used_bytes)}`,
        `  Quota:            ${formatBytes(usage.quota_bytes)}  (${pct.toFixed(1)}%)`,
        `  Max file size:    ${formatBytes(usage.max_file_bytes)}`,
      ].join("\n");
    });
  });

