import { Command } from "commander";
import chalk from "chalk";
import type { IntegrationResponse, CreateIntegrationResponse } from "@owlmetry/shared";
import { SUPPORTED_PROVIDER_IDS, INTEGRATION_PROVIDERS } from "@owlmetry/shared";
import { createClient } from "../config.js";
import { output } from "../formatters/index.js";

function formatIntegrationsTable(integrations: IntegrationResponse[]): string {
  if (integrations.length === 0) return chalk.dim("No integrations configured");

  const lines = [
    chalk.bold("Provider".padEnd(20) + "Enabled".padEnd(10) + "Created"),
    "─".repeat(55),
  ];
  for (const i of integrations) {
    const enabled = i.enabled ? chalk.green("yes") : chalk.red("no");
    lines.push(
      `${i.provider.padEnd(20)}${enabled.padEnd(10 + (enabled.length - (i.enabled ? 3 : 2)))}${new Date(i.created_at).toLocaleDateString()}`
    );
  }
  return lines.join("\n");
}

function formatIntegrationDetail(integration: IntegrationResponse): string {
  const lines = [
    chalk.bold(integration.provider),
    `  ID:      ${integration.id}`,
    `  Enabled: ${integration.enabled ? chalk.green("yes") : chalk.red("no")}`,
    `  Created: ${new Date(integration.created_at).toLocaleString()}`,
    "",
    chalk.bold("Config (redacted):"),
  ];
  for (const [key, value] of Object.entries(integration.config)) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join("\n");
}

export const integrationsCommand = new Command("integrations")
  .description("Manage project integrations (e.g. RevenueCat)");

integrationsCommand
  .command("providers")
  .description("List supported integration providers")
  .action(async (_, cmd) => {
    const { globals } = createClient(cmd);
    output(globals.format, INTEGRATION_PROVIDERS, () => {
      const lines = [
        chalk.bold("Supported Integration Providers"),
        "",
      ];
      for (const p of INTEGRATION_PROVIDERS) {
        lines.push(`  ${chalk.bold(p.id)} — ${p.name}`);
        lines.push(`    ${p.description}`);
        lines.push(`    Config fields:`);
        for (const f of p.configFields) {
          const req = f.required ? chalk.red("required") : chalk.dim("optional");
          lines.push(`      ${f.key} (${req}) — ${f.label}`);
        }
        lines.push("");
      }
      return lines.join("\n");
    });
  });

integrationsCommand
  .command("list")
  .description("List integrations for a project")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const integrations = await client.listIntegrations(opts.projectId);
    output(globals.format, integrations, () => formatIntegrationsTable(integrations));
  });

integrationsCommand
  .command("add <provider>")
  .description("Add an integration (e.g. revenuecat)")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--api-key <key>", "Provider API key")
  .option("--webhook-secret <secret>", "Webhook secret")
  .action(async (provider: string, opts: { projectId: string; apiKey?: string; webhookSecret?: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const config: Record<string, unknown> = {};
    if (opts.apiKey) config.api_key = opts.apiKey;
    if (opts.webhookSecret) config.webhook_secret = opts.webhookSecret;

    const result = await client.createIntegration(opts.projectId, { provider, config });
    output(globals.format, result, () => {
      const lines = [formatIntegrationDetail(result)];
      if (result.webhook_setup) {
        const ws = result.webhook_setup;
        lines.push("");
        lines.push(chalk.bold("── Webhook Setup (paste into RevenueCat) ──"));
        lines.push(`  Webhook URL:     ${ws.webhook_url}`);
        lines.push(`  Authorization:   ${chalk.yellow(ws.authorization_header)}`);
        lines.push(`  Environment:     ${ws.environment}`);
        lines.push(`  Events filter:   ${ws.events_filter}`);
        lines.push("");
        lines.push(chalk.dim("The authorization header contains the webhook secret. It will not be shown again."));
      }
      return lines.join("\n");
    });
  });

integrationsCommand
  .command("update <provider>")
  .description("Update an integration's config")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--api-key <key>", "Provider API key")
  .option("--webhook-secret <secret>", "Webhook secret")
  .option("--enable", "Enable the integration")
  .option("--disable", "Disable the integration")
  .action(async (provider: string, opts: { projectId: string; apiKey?: string; webhookSecret?: string; enable?: boolean; disable?: boolean }, cmd) => {
    const { client, globals } = createClient(cmd);

    const body: { config?: Record<string, unknown>; enabled?: boolean } = {};
    const config: Record<string, unknown> = {};
    if (opts.apiKey) config.api_key = opts.apiKey;
    if (opts.webhookSecret) config.webhook_secret = opts.webhookSecret;
    if (Object.keys(config).length > 0) body.config = config;
    if (opts.enable) body.enabled = true;
    if (opts.disable) body.enabled = false;

    const integration = await client.updateIntegration(provider, opts.projectId, body);
    output(globals.format, integration, () => formatIntegrationDetail(integration));
  });

integrationsCommand
  .command("remove <provider>")
  .description("Remove an integration")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (provider: string, opts: { projectId: string }, cmd) => {
    const { client } = createClient(cmd);
    await client.deleteIntegration(provider, opts.projectId);
    console.log(chalk.green(`Integration "${provider}" removed`));
  });

integrationsCommand
  .command("sync <provider>")
  .description("Sync user data from an integration provider")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--user <userId>", "Sync a single user instead of all")
  .action(async (provider: string, opts: { projectId: string; user?: string }, cmd) => {
    const { client, globals } = createClient(cmd);

    if (provider !== "revenuecat") {
      throw new Error(`Sync is not supported for provider "${provider}". Currently supported: revenuecat`);
    }

    if (opts.user) {
      const result = await client.syncRevenueCatUser(opts.projectId, opts.user);
      output(globals.format, result, () => {
        const lines = [
          chalk.bold(`Synced user: ${opts.user}`),
          `  Updated in ${result.updated} app(s)`,
          "",
          chalk.bold("Properties:"),
        ];
        for (const [key, value] of Object.entries(result.properties)) {
          lines.push(`  ${key}: ${value}`);
        }
        return lines.join("\n");
      });
    } else {
      const result = await client.syncRevenueCat(opts.projectId);
      output(globals.format, result, () => {
        return `${chalk.green("Sync started.")} ${result.total} users queued for sync.`;
      });
    }
  });
