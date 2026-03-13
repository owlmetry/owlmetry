import { Command, Option } from "commander";
import { resolveConfig } from "../config.js";
import { OwlMetryClient } from "../client.js";
import { output, type OutputFormat } from "../formatters/index.js";
import { formatAppsTable, formatAppDetail } from "../formatters/table.js";

export const appsCommand = new Command("apps")
  .description("List apps")
  .option("--project <id>", "Filter by project ID")
  .action(async (opts: { project?: string }, cmd) => {
    const globals = cmd.optsWithGlobals() as { format: OutputFormat; endpoint?: string; apiKey?: string };
    const config = resolveConfig(globals);
    const client = new OwlMetryClient({ endpoint: config.endpoint, apiKey: config.api_key });

    let apps = await client.listApps();
    if (opts.project) {
      apps = apps.filter((a) => a.project_id === opts.project);
    }
    output(globals.format, apps, () => formatAppsTable(apps));
  });

appsCommand
  .command("view <id>")
  .description("View app details")
  .action(async (id: string, _opts, cmd) => {
    const globals = cmd.optsWithGlobals() as { format: OutputFormat; endpoint?: string; apiKey?: string };
    const config = resolveConfig(globals);
    const client = new OwlMetryClient({ endpoint: config.endpoint, apiKey: config.api_key });

    const app = await client.getApp(id);
    output(globals.format, app, () => formatAppDetail(app));
  });

appsCommand
  .command("create")
  .description("Create a new app")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--name <name>", "App name")
  .addOption(
    new Option("--platform <platform>", "Platform")
      .choices(["ios", "ipados", "macos", "android", "web"])
      .makeOptionMandatory(),
  )
  .requiredOption("--bundle-id <bundleId>", "Bundle identifier")
  .action(async (opts: { project: string; name: string; platform: string; bundleId: string }, cmd: Command) => {
    const globals = cmd.optsWithGlobals() as { format: OutputFormat; endpoint?: string; apiKey?: string };
    const config = resolveConfig(globals);
    const client = new OwlMetryClient({ endpoint: config.endpoint, apiKey: config.api_key });

    const app = await client.createApp({
      project_id: opts.project,
      name: opts.name,
      platform: opts.platform,
      bundle_id: opts.bundleId,
    });
    output(globals.format, app, () => formatAppDetail(app));
  });

appsCommand
  .command("update <id>")
  .description("Update app name")
  .requiredOption("--name <name>", "New app name")
  .action(async (id: string, opts: { name: string }, cmd) => {
    const globals = cmd.optsWithGlobals() as { format: OutputFormat; endpoint?: string; apiKey?: string };
    const config = resolveConfig(globals);
    const client = new OwlMetryClient({ endpoint: config.endpoint, apiKey: config.api_key });

    const app = await client.updateApp(id, { name: opts.name });
    output(globals.format, app, () => formatAppDetail(app));
  });
