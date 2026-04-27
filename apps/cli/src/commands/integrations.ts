import { readFileSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import type { IntegrationResponse, CreateIntegrationResponse } from "@owlmetry/shared";
import {
  SUPPORTED_PROVIDER_IDS,
  INTEGRATION_PROVIDERS,
  INTEGRATION_PROVIDER_IDS,
} from "@owlmetry/shared";
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

interface IntegrationConfigFlags {
  apiKey?: string;
  clientId?: string;
  teamId?: string;
  keyId?: string;
  orgId?: string;
  issuerId?: string;
  privateKeyP8File?: string;
}

function collectIntegrationConfig(opts: IntegrationConfigFlags): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (opts.apiKey) config.api_key = opts.apiKey;
  if (opts.clientId) config.client_id = opts.clientId;
  if (opts.teamId) config.team_id = opts.teamId;
  if (opts.keyId) config.key_id = opts.keyId;
  if (opts.orgId) config.org_id = opts.orgId;
  if (opts.issuerId) config.issuer_id = opts.issuerId;
  if (opts.privateKeyP8File) {
    try {
      config.private_key_p8 = readFileSync(opts.privateKeyP8File, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read .p8 file at ${opts.privateKeyP8File}: ${message}`);
    }
  }
  return config;
}

integrationsCommand
  .command("add <provider>")
  .description("Add an integration (revenuecat | apple-search-ads | app-store-connect). For apple-search-ads, Owlmetry generates the keypair — run without ID flags, upload the printed public key to Apple, then run `integrations update apple-search-ads` with the returned IDs. For app-store-connect, pass --issuer-id, --key-id, and --private-key-p8-file pointing to the .p8 you downloaded from App Store Connect.")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--api-key <key>", "RevenueCat V2 Secret API key")
  .option("--issuer-id <id>", "App Store Connect Issuer ID (UUID)")
  .option("--key-id <id>", "Apple key ID — used by both apple-search-ads and app-store-connect")
  .option("--private-key-p8-file <path>", "App Store Connect: path to the .p8 file downloaded from App Store Connect")
  .action(async (provider: string, opts: { projectId: string } & IntegrationConfigFlags, cmd) => {
    const { client, globals } = createClient(cmd);
    const config = collectIntegrationConfig(opts);

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
      if (provider === INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS) {
        const publicKey = result.config.public_key_pem || "";
        lines.push("");
        lines.push(chalk.bold("── Public Key (upload to Apple) ──"));
        lines.push(publicKey);
        lines.push("");
        lines.push(chalk.bold("Next steps:"));
        lines.push("  1. Go to ads.apple.com → Account Settings → User Management. Invite (or reuse) an API user with role \"API Account Read Only\".");
        lines.push("  2. On the API tab for that user, paste the public key above.");
        lines.push("  3. Apple will respond with client_id, team_id, and key_id. Run:");
        lines.push(chalk.cyan(`     owlmetry integrations update apple-search-ads \\`));
        lines.push(chalk.cyan(`       --project-id ${opts.projectId} \\`));
        lines.push(chalk.cyan(`       --client-id <...> --team-id <...> --key-id <...>`));
        lines.push("  4. Then pick the org:");
        lines.push(chalk.cyan(`     owlmetry integrations update apple-search-ads --project-id ${opts.projectId} --org-id <orgId>`));
        lines.push(chalk.dim("     (org_id is the \"Account ID\" shown in the ads.apple.com profile menu)"));
      }
      if (provider === INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT) {
        lines.push("");
        lines.push(chalk.green("✓ App Store Connect integration created. Trigger a sync next:"));
        lines.push(chalk.cyan(`     owlmetry integrations sync app-store-connect --project-id ${opts.projectId}`));
        lines.push(chalk.dim("     Or test credentials first: owlmetry integrations test app-store-connect --project-id <id>"));
      }
      return lines.join("\n");
    });
  });

integrationsCommand
  .command("update <provider>")
  .description("Update an integration's config. For apple-search-ads, pass the IDs Apple returned after you uploaded the public key (auto-enables when all four are present). For app-store-connect, pass --issuer-id, --key-id, and/or --private-key-p8-file to rotate credentials; omit --private-key-p8-file to keep the existing key.")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--api-key <key>", "RevenueCat V2 Secret API key")
  .option("--client-id <id>", "Apple Ads client ID (SEARCHADS.*)")
  .option("--team-id <id>", "Apple Ads team ID (SEARCHADS.*)")
  .option("--key-id <id>", "Apple key ID — used by both apple-search-ads and app-store-connect")
  .option("--org-id <id>", "Apple Ads org ID (a.k.a. Account ID)")
  .option("--issuer-id <id>", "App Store Connect Issuer ID")
  .option("--private-key-p8-file <path>", "App Store Connect: replace the stored .p8 with the contents of this file (omit to keep existing)")
  .option("--enable", "Enable the integration (ignored for apple-search-ads / app-store-connect — derived from config completeness)")
  .option("--disable", "Disable the integration (ignored for apple-search-ads / app-store-connect — remove the integration instead)")
  .action(async (provider: string, opts: { projectId: string; enable?: boolean; disable?: boolean } & IntegrationConfigFlags, cmd) => {
    const { client, globals } = createClient(cmd);

    const body: { config?: Record<string, unknown>; enabled?: boolean } = {};
    const config = collectIntegrationConfig(opts);
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
  .command("copy <provider>")
  .description("Copy an integration's credentials from another project in the same team")
  .requiredOption("--from <id>", "Source project ID (has an existing integration for <provider>)")
  .requiredOption("--to <id>", "Target project ID (will receive a copy of the credentials)")
  .action(async (provider: string, opts: { from: string; to: string }, cmd) => {
    const { client, globals } = createClient(cmd);
    const result = await client.copyIntegration(provider, opts.from, opts.to);
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
        lines.push(chalk.dim("A new webhook secret was generated for this project. The source project keeps its own secret."));
      }
      const test = (result as { connection_test?: { ok: boolean; orgs?: Array<{ org_id: number; org_name: string }>; error?: string; message?: string } }).connection_test;
      if (test) {
        lines.push("");
        if (test.ok) {
          lines.push(chalk.bold("── Apple Search Ads connection test: OK ──"));
          lines.push(chalk.dim("Apple accepted the copied credentials. Integration is active on the target — no further setup needed."));
          for (const o of test.orgs ?? []) {
            lines.push(`  ${o.org_name} (orgId ${o.org_id})`);
          }
        } else {
          lines.push(chalk.bold(chalk.red("── Apple Search Ads connection test: FAILED ──")));
          lines.push(`  ${test.error}: ${test.message}`);
          lines.push(chalk.dim("Copy is saved; debug via Test Connection once the underlying issue is resolved."));
        }
      }
      return lines.join("\n");
    });
  });

integrationsCommand
  .command("sync <provider>")
  .description("Sync user data from an integration provider (revenuecat | apple-search-ads)")
  .requiredOption("--project-id <id>", "Project ID")
  .option("--user <userId>", "Sync a single user instead of all")
  .action(async (provider: string, opts: { projectId: string; user?: string }, cmd) => {
    const { client, globals } = createClient(cmd);

    if (provider === INTEGRATION_PROVIDER_IDS.REVENUECAT) {
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
      return;
    }

    if (provider === INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS) {
      if (opts.user) {
        const result = await client.syncAppleSearchAdsUser(opts.projectId, opts.user);
        output(globals.format, result, () => {
          const lines = [
            chalk.bold(`Synced user: ${opts.user}`),
            `  Updated ${result.updated} property field(s)`,
            "",
            chalk.bold("Properties written:"),
          ];
          for (const [key, value] of Object.entries(result.properties)) {
            lines.push(`  ${key}: ${value}`);
          }
          return lines.join("\n");
        });
      } else {
        const result = await client.syncAppleSearchAds(opts.projectId);
        output(globals.format, result, () => {
          return `${chalk.green("Sync started.")} ${result.total} users queued for sync.`;
        });
      }
      return;
    }

    if (provider === INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT) {
      if (opts.user) {
        throw new Error("--user is not supported for app-store-connect (reviews are app-scoped, not user-scoped)");
      }
      const result = await client.syncAppStoreConnect(opts.projectId);
      output(globals.format, result, () => {
        if (!result.syncing) return chalk.dim("No Apple apps with apple_app_store_id in this project — nothing to sync.");
        return `${chalk.green("Sync started.")} ${result.total} app${result.total === 1 ? "" : "s"} queued. Job: ${result.job_run_id ?? "unknown"}`;
      });
      return;
    }

    throw new Error(`Sync is not supported for provider "${provider}". Supported: revenuecat, apple-search-ads, app-store-connect`);
  });

integrationsCommand
  .command("test <provider>")
  .description("Test an integration's credentials (apple-search-ads | app-store-connect)")
  .requiredOption("--project-id <id>", "Project ID")
  .action(async (provider: string, opts: { projectId: string }, cmd) => {
    const { client, globals } = createClient(cmd);

    if (provider === INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS) {
      const result = await client.testAppleSearchAds(opts.projectId);
      output(globals.format, result, () => {
        const lines: string[] = [];
        if (result.ok) {
          lines.push(chalk.green("✓ Credentials valid"));
          if (result.orgs && result.orgs.length > 0) {
            lines.push("");
            lines.push(chalk.bold("Accessible Orgs:"));
            for (const o of result.orgs) {
              const marker = o.matches_configured_org_id ? chalk.green("✓") : " ";
              lines.push(`  ${marker} ${o.org_id} — ${o.org_name}`);
            }
          }
        } else {
          lines.push(chalk.red(`✗ Connection failed: ${result.message ?? result.error ?? "unknown error"}`));
        }
        return lines.join("\n");
      });
      return;
    }

    if (provider === INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT) {
      const result = await client.testAppStoreConnect(opts.projectId);
      output(globals.format, result, () => {
        const lines: string[] = [];
        if (result.ok) {
          lines.push(chalk.green("✓ Credentials valid"));
          if (result.apps && result.apps.length > 0) {
            lines.push("");
            lines.push(chalk.bold(`${result.apps.length} app${result.apps.length === 1 ? "" : "s"} visible:`));
            for (const a of result.apps) {
              lines.push(`  ${a.name} ${chalk.dim(`(${a.bundle_id}, ASC id ${a.id})`)}`);
            }
          }
        } else {
          lines.push(chalk.red(`✗ Connection failed: ${result.message ?? result.error ?? "unknown error"}`));
        }
        return lines.join("\n");
      });
      return;
    }

    throw new Error(`Test is not supported for provider "${provider}". Supported: apple-search-ads, app-store-connect`);
  });
