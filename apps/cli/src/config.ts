import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CliConfig {
  endpoint: string;
  api_key: string;
}

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
  const file = loadConfig();

  const endpoint =
    opts.endpoint ?? process.env.OWLMETRY_ENDPOINT ?? file?.endpoint;
  const api_key =
    opts.apiKey ?? process.env.OWLMETRY_API_KEY ?? file?.api_key;

  if (!endpoint) {
    throw new Error(
      "Missing endpoint. Use --endpoint, OWLMETRY_ENDPOINT env var, or run `owlmetry setup`."
    );
  }
  if (!api_key) {
    throw new Error(
      "Missing API key. Use --api-key, OWLMETRY_API_KEY env var, or run `owlmetry setup`."
    );
  }

  return { endpoint, api_key };
}
