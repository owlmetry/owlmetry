import { Command, Option } from "commander";
import { APP_PLATFORMS } from "@owlmetry/shared";
import type { AppPlatform } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output } from "../formatters/index.js";
import { formatAppsTable, formatAppDetail } from "../formatters/table.js";

export const appsCommand = new Command("apps")
  .description("List apps")
  .enablePositionalOptions()
  .option("--project-id <id>", "Filter by project ID")
  .action(async (opts: { projectId?: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    let apps = await client.listApps();
    if (opts.projectId) {
      apps = apps.filter((a) => a.project_id === opts.projectId);
    }
    output(globals.format, apps, () => formatAppsTable(apps));
  });

appsCommand
  .command("view <id>")
  .description("View app details")
  .action(async (id: string, _opts, cmd) => {
    const { client, globals } = createClient(cmd);
    const app = await client.getApp(id);
    output(globals.format, app, () => formatAppDetail(app));
  });

appsCommand
  .command("create")
  .description("Create a new app")
  .requiredOption("--project-id <id>", "Project ID")
  .requiredOption("--name <name>", "App name")
  .addOption(
    new Option("--platform <platform>", "Platform")
      .choices([...APP_PLATFORMS])
      .makeOptionMandatory(),
  )
  .option("--bundle-id <bundleId>", "Bundle identifier (required for non-backend platforms)")
  .action(async (opts: { projectId: string; name: string; platform: string; bundleId?: string }, cmd: Command) => {
    if (opts.platform !== "backend" && !opts.bundleId) {
      console.error("Error: --bundle-id is required for non-backend platforms");
      process.exit(1);
    }

    const { client, globals } = createClient(cmd);
    const app = await client.createApp({
      project_id: opts.projectId,
      name: opts.name,
      platform: opts.platform as AppPlatform,
      ...(opts.bundleId ? { bundle_id: opts.bundleId } : {}),
    });
    output(globals.format, app, () => formatAppDetail(app));
  });

appsCommand
  .command("update <id>")
  .description("Update app name")
  .requiredOption("--name <name>", "New app name")
  .action(async (id: string, opts: { name: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const app = await client.updateApp(id, { name: opts.name });
    output(globals.format, app, () => formatAppDetail(app));
  });
