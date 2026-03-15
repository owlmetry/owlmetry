import type { OwlConfiguration } from "./types.js";

const CLIENT_KEY_PREFIX = "owl_client_";

export interface ValidatedConfig {
  endpoint: string;
  apiKey: string;
  serviceName: string;
  appVersion?: string;
  debug: boolean;
  isDebug: boolean;
  flushIntervalMs: number;
  flushThreshold: number;
  maxBufferSize: number;
}

export function validateConfiguration(config: OwlConfiguration): ValidatedConfig {
  if (!config.endpoint || typeof config.endpoint !== "string") {
    throw new Error("OwlMetry: endpoint is required");
  }

  let endpoint = config.endpoint;
  // Strip trailing slash
  if (endpoint.endsWith("/")) {
    endpoint = endpoint.slice(0, -1);
  }

  try {
    new URL(endpoint);
  } catch {
    throw new Error(`OwlMetry: invalid endpoint URL: ${endpoint}`);
  }

  if (!config.apiKey || typeof config.apiKey !== "string") {
    throw new Error("OwlMetry: apiKey is required");
  }

  if (!config.apiKey.startsWith(CLIENT_KEY_PREFIX)) {
    throw new Error(`OwlMetry: apiKey must start with "${CLIENT_KEY_PREFIX}"`);
  }

  return {
    endpoint,
    apiKey: config.apiKey,
    serviceName: config.serviceName || "unknown",
    appVersion: config.appVersion,
    debug: config.debug ?? false,
    isDebug: config.isDebug ?? (process.env.NODE_ENV !== "production"),
    flushIntervalMs: config.flushIntervalMs ?? 5000,
    flushThreshold: config.flushThreshold ?? 20,
    maxBufferSize: config.maxBufferSize ?? 10000,
  };
}
