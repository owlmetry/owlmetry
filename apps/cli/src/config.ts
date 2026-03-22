import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Command } from "commander";
import { OwlMetryClient } from "./client.js";
import type { OutputFormat } from "./formatters/index.js";

export interface TeamProfile {
  api_key: string;
  team_name: string;
  team_slug: string;
}

export interface CliConfig {
  endpoint: string;
  ingest_endpoint?: string;
  active_team: string;
  teams: Record<string, TeamProfile>;
}

export interface ResolvedConfig {
  endpoint: string;
  api_key: string;
  ingest_endpoint?: string;
}

export interface GlobalOptions {
  format: OutputFormat;
  endpoint?: string;
  apiKey?: string;
  ingestEndpoint?: string;
  team?: string;
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

/**
 * Resolve a team profile by ID (exact), slug (exact), or name (case-insensitive).
 * Throws with a list of available teams if no match is found.
 */
export function getActiveProfile(config: CliConfig, teamHint?: string): { teamId: string; profile: TeamProfile } {
  const entries = Object.entries(config.teams);
  if (entries.length === 0) {
    throw new Error("No team profiles configured. Run `owlmetry auth verify` to add one.");
  }

  if (!teamHint) {
    const profile = config.teams[config.active_team];
    if (!profile) {
      throw new Error(
        `Active team "${config.active_team}" not found in config. Run \`owlmetry auth verify\` to re-authenticate.`
      );
    }
    return { teamId: config.active_team, profile };
  }

  // Try exact ID match
  if (config.teams[teamHint]) {
    return { teamId: teamHint, profile: config.teams[teamHint] };
  }

  // Try exact slug match
  for (const [id, profile] of entries) {
    if (profile.team_slug === teamHint) {
      return { teamId: id, profile };
    }
  }

  // Try case-insensitive name match
  const lower = teamHint.toLowerCase();
  for (const [id, profile] of entries) {
    if (profile.team_name.toLowerCase() === lower) {
      return { teamId: id, profile };
    }
  }

  const available = entries
    .map(([id, p]) => `  ${id}  ${p.team_name} (${p.team_slug})`)
    .join("\n");
  throw new Error(`No team matching "${teamHint}". Available teams:\n${available}`);
}

/**
 * List all configured profiles with an active indicator.
 */
export function listProfiles(config: CliConfig): Array<{ teamId: string; profile: TeamProfile; active: boolean }> {
  return Object.entries(config.teams).map(([teamId, profile]) => ({
    teamId,
    profile,
    active: teamId === config.active_team,
  }));
}

export function resolveConfig(opts: {
  endpoint?: string;
  apiKey?: string;
  team?: string;
}): ResolvedConfig {
  const envEndpoint = opts.endpoint ?? process.env.OWLMETRY_ENDPOINT;
  const envApiKey = opts.apiKey ?? process.env.OWLMETRY_API_KEY;

  // Skip file read if both values are already resolved
  const file = envEndpoint && envApiKey ? null : loadConfig();

  let endpoint = envEndpoint;
  let api_key = envApiKey;
  let ingest_endpoint = file?.ingest_endpoint;

  // Resolve from config file profiles if not already set
  if (file && !api_key) {
    const { profile } = getActiveProfile(file, opts.team);
    api_key = profile.api_key;
  }
  if (!endpoint) {
    endpoint = file?.endpoint;
  }

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

  return { endpoint, api_key, ingest_endpoint };
}

/**
 * Resolve the ingest endpoint from flags → env → config file → derived from API endpoint.
 * For the hosted platform: defaults to ingest.owlmetry.com
 * For self-hosted: defaults to the same as the API endpoint
 */
export function resolveIngestEndpoint(opts: { ingestEndpoint?: string }, config: ResolvedConfig): string {
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
