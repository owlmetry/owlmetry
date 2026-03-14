import Table from "cli-table3";
import chalk from "chalk";
import type { ProjectResponse, ProjectDetailResponse, AppResponse, StoredEventResponse } from "@owlmetry/shared";
import { truncate, getTerminalWidth } from "../utils/truncate.js";

export function formatProjectsTable(projects: ProjectResponse[]): string {
  const table = new Table({
    head: [chalk.bold("ID"), chalk.bold("Name"), chalk.bold("Slug"), chalk.bold("Team ID"), chalk.bold("Created")],
  });
  for (const p of projects) {
    table.push([p.id, p.name, p.slug, p.team_id, p.created_at]);
  }
  return table.toString();
}

export function formatProjectDetail(project: ProjectDetailResponse): string {
  const lines = [
    `${chalk.bold("ID:")}         ${project.id}`,
    `${chalk.bold("Name:")}       ${project.name}`,
    `${chalk.bold("Slug:")}       ${project.slug}`,
    `${chalk.bold("Team ID:")}    ${project.team_id}`,
    `${chalk.bold("Created:")}    ${project.created_at}`,
  ];

  if (project.apps.length > 0) {
    lines.push("", chalk.bold("Apps:"));
    const table = new Table({
      head: [chalk.bold("ID"), chalk.bold("Name"), chalk.bold("Platform"), chalk.bold("Bundle ID"), chalk.bold("Created")],
    });
    for (const a of project.apps) {
      table.push([a.id, a.name, a.platform, a.bundle_id, a.created_at]);
    }
    lines.push(table.toString());
  } else {
    lines.push("", chalk.dim("No apps"));
  }

  return lines.join("\n");
}

export function formatAppsTable(apps: AppResponse[]): string {
  const table = new Table({
    head: [chalk.bold("ID"), chalk.bold("Name"), chalk.bold("Platform"), chalk.bold("Bundle ID"), chalk.bold("Project ID"), chalk.bold("Created")],
  });
  for (const a of apps) {
    table.push([a.id, a.name, a.platform, a.bundle_id, a.project_id, a.created_at]);
  }
  return table.toString();
}

export function formatAppDetail(app: AppResponse): string {
  return [
    `${chalk.bold("ID:")}          ${app.id}`,
    `${chalk.bold("Name:")}        ${app.name}`,
    `${chalk.bold("Platform:")}    ${app.platform}`,
    `${chalk.bold("Bundle ID:")}   ${app.bundle_id}`,
    `${chalk.bold("Project ID:")}  ${app.project_id}`,
    `${chalk.bold("Team ID:")}     ${app.team_id}`,
    `${chalk.bold("Created:")}     ${app.created_at}`,
  ].join("\n");
}

export function formatEventsTable(events: StoredEventResponse[]): string {
  const msgWidth = Math.max(20, Math.min(60, getTerminalWidth() - 80));
  const table = new Table({
    head: [chalk.bold("Timestamp"), chalk.bold("Level"), chalk.bold("Message"), chalk.bold("User"), chalk.bold("Screen")],
  });
  for (const e of events) {
    table.push([
      e.timestamp,
      e.level,
      truncate(e.message, msgWidth),
      e.user_id ?? "",
      e.screen_name ?? "",
    ]);
  }
  return table.toString();
}

export function formatEventDetail(event: StoredEventResponse): string {
  const lines = [
    `${chalk.bold("ID:")}              ${event.id}`,
    `${chalk.bold("App ID:")}          ${event.app_id}`,
    `${chalk.bold("Timestamp:")}       ${event.timestamp}`,
    `${chalk.bold("Received:")}        ${event.received_at}`,
    `${chalk.bold("Level:")}           ${event.level}`,
    `${chalk.bold("Message:")}         ${event.message}`,
    `${chalk.bold("User ID:")}         ${event.user_id ?? "—"}`,
    `${chalk.bold("Session ID:")}      ${event.session_id}`,
    `${chalk.bold("Screen:")}          ${event.screen_name ?? "—"}`,
    `${chalk.bold("Source Module:")}   ${event.source_module ?? "—"}`,
    `${chalk.bold("Platform:")}        ${event.platform ?? "—"}`,
    `${chalk.bold("OS Version:")}      ${event.os_version ?? "—"}`,
    `${chalk.bold("App Version:")}     ${event.app_version ?? "—"}`,
    `${chalk.bold("Build Number:")}    ${event.build_number ?? "—"}`,
    `${chalk.bold("Device Model:")}    ${event.device_model ?? "—"}`,
    `${chalk.bold("Locale:")}          ${event.locale ?? "—"}`,
  ];

  if (event.custom_attributes && Object.keys(event.custom_attributes).length > 0) {
    lines.push("", chalk.bold("Custom Attributes:"));
    for (const [key, value] of Object.entries(event.custom_attributes)) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  return lines.join("\n");
}
