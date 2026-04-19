import Table from "cli-table3";
import chalk from "chalk";
import type { ProjectResponse, ProjectDetailResponse, AppResponse, AppUserResponse, StoredEventResponse, StoredMetricEventResponse } from "@owlmetry/shared";
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
    `${chalk.bold("Color:")}      ${project.color}`,
    `${chalk.bold("Team ID:")}    ${project.team_id}`,
    `${chalk.bold("Retention:")}  Events: ${project.effective_retention_days_events}d, Metrics: ${project.effective_retention_days_metrics}d, Funnels: ${project.effective_retention_days_funnels}d`,
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

export function formatAppUsersTable(users: AppUserResponse[]): string {
  const table = new Table({
    head: [chalk.bold("User ID"), chalk.bold("Type"), chalk.bold("Apps"), chalk.bold("Claims"), chalk.bold("First Seen"), chalk.bold("Last Seen")],
  });
  for (const u of users) {
    const appNames = u.apps?.map((a) => a.app_name).join(", ") || "-";
    table.push([
      u.user_id,
      u.is_anonymous ? "anon" : "real",
      appNames,
      String(u.claimed_from?.length ?? 0),
      u.first_seen_at,
      u.last_seen_at,
    ]);
  }
  return table.toString();
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
    `${chalk.bold("Environment:")}     ${event.environment ?? "—"}`,
    `${chalk.bold("OS Version:")}      ${event.os_version ?? "—"}`,
    `${chalk.bold("App Version:")}     ${event.app_version ?? "—"}`,
    `${chalk.bold("Build Number:")}    ${event.build_number ?? "—"}`,
    `${chalk.bold("Device Model:")}    ${event.device_model ?? "—"}`,
    `${chalk.bold("Locale:")}          ${event.locale ?? "—"}`,
    `${chalk.bold("Dev Build:")}       ${event.is_dev ? chalk.yellow("Yes") : "No"}`,
  ];

  if (event.custom_attributes && Object.keys(event.custom_attributes).length > 0) {
    lines.push("", chalk.bold("Custom Attributes:"));
    for (const [key, value] of Object.entries(event.custom_attributes)) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  return lines.join("\n");
}

export function formatMetricEventsTable(events: StoredMetricEventResponse[]): string {
  if (events.length === 0) return chalk.dim("No metric events found");

  const table = new Table({
    head: [
      chalk.bold("Timestamp"),
      chalk.bold("Phase"),
      chalk.bold("Duration"),
      chalk.bold("Tracking ID"),
      chalk.bold("Error"),
      chalk.bold("User ID"),
    ],
  });
  for (const e of events) {
    table.push([
      e.timestamp,
      e.phase,
      e.duration_ms != null ? `${e.duration_ms}ms` : "",
      truncate(e.tracking_id ?? "", 12),
      truncate(e.error ?? "", 20),
      truncate(e.user_id ?? "", 12),
    ]);
  }
  return table.toString();
}
