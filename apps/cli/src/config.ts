import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Command } from "commander";
import { OwlMetryClient } from "./client.js";
import type { OutputFormat } from "./formatters/index.js";

export interface CliConfig {
  endpoint: string;
  api_key: string;
  ingest_endpoint?: string;
}

export interface GlobalOptions {
  format: OutputFormat;
  endpoint?: string;
  apiKey?: string;
  ingestEndpoint?: string;
}

export const DEFAULT_ENDPOINT = "https://api.owlmetry.com";
export const DEFAULT_INGEST_ENDPOINT = "https://ingest.owlmetry.com";

const CONFIG_DIR = join(homedir(), ".owlmetry");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function loadConfig(): CliConfig | null {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function resolveConfig(opts: {
  endpoint?: string;
  apiKey?: string;
}): CliConfig {
  const envEndpoint = opts.endpoint ?? process.env.OWLMETRY_ENDPOINT;
  const envApiKey = opts.apiKey ?? process.env.OWLMETRY_API_KEY;

  // Skip file read if both values are already resolved
  const file = envEndpoint && envApiKey ? null : loadConfig();

  const endpoint = envEndpoint ?? file?.endpoint;
  const api_key = envApiKey ?? file?.api_key;

  if (!endpoint) {
    throw new Error(
      "Missing endpoint. Use --endpoint, OWLMETRY_ENDPOINT env var, or run `owlmetry auth login`."
    );
  }
  if (!api_key) {
    throw new Error(
      "Missing API key. Use --api-key, OWLMETRY_API_KEY env var, or run `owlmetry auth login`."
    );
  }

  return { endpoint, api_key, ingest_endpoint: file?.ingest_endpoint };
}

/**
 * Resolve the ingest endpoint from flags → env → config file → derived from API endpoint.
 * For the hosted platform: defaults to ingest.owlmetry.com
 * For self-hosted: defaults to the same as the API endpoint
 */
export function resolveIngestEndpoint(opts: { ingestEndpoint?: string }, config: CliConfig): string {
  const explicit = opts.ingestEndpoint ?? process.env.OWLMETRY_INGEST_ENDPOINT;
  if (explicit) return explicit;

  if (config.ingest_endpoint) return config.ingest_endpoint;

  // Derive: if using the hosted API, use the hosted ingest endpoint
  if (config.endpoint === DEFAULT_ENDPOINT) return DEFAULT_INGEST_ENDPOINT;

  // Self-hosted: default to same as API endpoint
  return config.endpoint;
}

export function getGlobals(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals() as GlobalOptions;
}

export function createClient(cmd: Command): { client: OwlMetryClient; globals: GlobalOptions } {
  const globals = getGlobals(cmd);
  const config = resolveConfig(globals);
  const client = new OwlMetryClient({ endpoint: config.endpoint, apiKey: config.api_key });
  return { client, globals };
}
