import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { validateConfiguration, type ValidatedConfig } from "./configuration.js";
import { Transport } from "./transport.js";
import type { OwlConfiguration, LogLevel, LogEvent } from "./types.js";
import { Operation } from "./operation.js";

export type { OwlConfiguration, LogLevel, LogEvent } from "./types.js";
export { Operation } from "./operation.js";

const MAX_ATTRIBUTE_VALUE_LENGTH = 200;
const SLUG_REGEX = /^[a-z0-9-]+$/;
const TRACK_MESSAGE_PREFIX = "track:";

const EXPERIMENTS_DIR = join(homedir(), ".owlmetry");
const EXPERIMENTS_FILE = join(EXPERIMENTS_DIR, "experiments.json");

let experiments: Record<string, string> = {};

function loadExperiments(): void {
  try {
    const data = readFileSync(EXPERIMENTS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      experiments = parsed as Record<string, string>;
    }
  } catch {
    // File doesn't exist or is invalid — start with empty experiments
    experiments = {};
  }
}

function saveExperiments(): void {
  try {
    mkdirSync(EXPERIMENTS_DIR, { recursive: true });
    writeFileSync(EXPERIMENTS_FILE, JSON.stringify(experiments, null, 2), "utf-8");
  } catch (err) {
    if (config?.debug) {
      console.error("OwlMetry: failed to save experiments:", err);
    }
  }
}

/**
 * Normalize a metric slug to contain only lowercase letters, numbers, and hyphens.
 * Logs a warning if the slug was modified. Returns the normalized slug.
 */
function normalizeSlug(slug: string): string {
  if (SLUG_REGEX.test(slug)) return slug;
  const normalized = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (config?.debug) {
    console.error(
      `OwlMetry: metric slug "${slug}" was auto-corrected to "${normalized}". Slugs should contain only lowercase letters, numbers, and hyphens.`,
    );
  }
  return normalized;
}

function getSourceModule(): string | undefined {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return undefined;

  const lines = stack.split("\n");
  // Skip: Error, at Object.<method> (index.ts), at Owl.<method> / ScopedOwl.<method>
  // Find the first frame outside this file
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes("node:") || line.includes("node_modules")) continue;

    // Extract file:line from "at <something> (file:line:col)" or "at file:line:col"
    const parenMatch = line.match(/\((.+):(\d+):\d+\)$/);
    if (parenMatch) return `${parenMatch[1]}:${parenMatch[2]}`;

    const directMatch = line.match(/at (.+):(\d+):\d+$/);
    if (directMatch) return `${directMatch[1]}:${directMatch[2]}`;
  }

  return undefined;
}

function normalizeAttributes(attrs?: Record<string, unknown>): Record<string, string> | undefined {
  if (!attrs || Object.keys(attrs).length === 0) return undefined;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    let str = String(value);
    if (str.length > MAX_ATTRIBUTE_VALUE_LENGTH) {
      str = str.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
    }
    result[key] = str;
  }
  return result;
}

let config: ValidatedConfig | null = null;
let transport: Transport | null = null;
let sessionId: string | null = null;
let beforeExitRegistered = false;

function ensureConfigured(): { config: ValidatedConfig; transport: Transport; sessionId: string } {
  if (!config || !transport || !sessionId) {
    throw new Error("OwlMetry: not configured. Call Owl.configure() first.");
  }
  return { config, transport, sessionId };
}

function createEvent(
  ctx: { config: ValidatedConfig; sessionId: string },
  level: LogLevel,
  message: string,
  attrs?: Record<string, unknown>,
  userId?: string,
): LogEvent {
  return {
    client_event_id: randomUUID(),
    session_id: ctx.sessionId,
    ...(userId ? { user_id: userId } : {}),
    level,
    source_module: getSourceModule(),
    message,
    custom_attributes: normalizeAttributes(attrs),
    ...(Object.keys(experiments).length > 0 ? { experiments: { ...experiments } } : {}),
    environment: "backend",
    ...(ctx.config.appVersion ? { app_version: ctx.config.appVersion } : {}),
    is_dev: ctx.config.isDev,
    timestamp: new Date().toISOString(),
  };
}

function log(level: LogLevel, message: string, attrs?: Record<string, unknown>, userId?: string): void {
  try {
    const ctx = ensureConfigured();
    const event = createEvent(ctx, level, message, attrs, userId);
    ctx.transport.enqueue(event);
  } catch (err) {
    if (config?.debug) {
      console.error("OwlMetry:", err);
    }
  }
}

/**
 * A scoped logger instance that automatically sets a user ID on all events.
 */
export class ScopedOwl {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  info(message: string, attrs?: Record<string, unknown>): void {
    log("info", message, attrs, this.userId);
  }

  debug(message: string, attrs?: Record<string, unknown>): void {
    log("debug", message, attrs, this.userId);
  }

  warn(message: string, attrs?: Record<string, unknown>): void {
    log("warn", message, attrs, this.userId);
  }

  error(message: string, attrs?: Record<string, unknown>): void {
    log("error", message, attrs, this.userId);
  }

  /**
   * Track a named step (e.g. funnel step, user action). Sends an info-level event
   * with message `track:<stepName>`.
   */
  track(stepName: string, attributes?: Record<string, string>): void {
    log("info", `${TRACK_MESSAGE_PREFIX}${stepName}`, attributes, this.userId);
  }

  /**
   * Start a tracked operation. The `metric` slug should contain only lowercase letters,
   * numbers, and hyphens (e.g. "photo-conversion", "api-request"). Invalid characters
   * are auto-corrected with a warning logged in debug mode.
   */
  startOperation(metric: string, attrs?: Record<string, unknown>): Operation {
    return new Operation(log, normalizeSlug(metric), attrs, this.userId);
  }

  /**
   * Record a single-shot metric. The `metric` slug should contain only lowercase letters,
   * numbers, and hyphens (e.g. "onboarding", "checkout"). Invalid characters are
   * auto-corrected with a warning logged in debug mode.
   */
  recordMetric(metric: string, attrs?: Record<string, unknown>): void {
    log("info", `metric:${normalizeSlug(metric)}:record`, attrs, this.userId);
  }
}

/**
 * OwlMetry Node.js Server SDK.
 *
 * Usage:
 * ```
 * import { Owl } from '@owlmetry/node';
 *
 * Owl.configure({ endpoint: 'https://...', apiKey: 'owl_client_...' });
 * Owl.info('Server started');
 *
 * const owl = Owl.withUser('user_123');
 * owl.info('User logged in');
 *
 * await Owl.shutdown();
 * ```
 */
export const Owl = {
  configure(options: OwlConfiguration): void {
    // Clean up previous transport if reconfiguring
    if (transport) {
      transport.shutdown().catch(() => {});
    }
    config = validateConfiguration(options);
    transport = new Transport(config);
    sessionId = randomUUID();

    loadExperiments();

    if (!beforeExitRegistered) {
      beforeExitRegistered = true;
      process.on("beforeExit", async () => {
        try {
          if (transport && transport.bufferSize > 0) {
            await transport.flush();
          }
        } catch {
          // Best-effort flush on exit — never crash the host process
        }
      });
    }

    // Emit session start event
    log("info", "sdk:session_started");
  },

  info(message: string, attrs?: Record<string, unknown>): void {
    log("info", message, attrs);
  },

  debug(message: string, attrs?: Record<string, unknown>): void {
    log("debug", message, attrs);
  },

  warn(message: string, attrs?: Record<string, unknown>): void {
    log("warn", message, attrs);
  },

  error(message: string, attrs?: Record<string, unknown>): void {
    log("error", message, attrs);
  },

  /**
   * Track a named step (e.g. funnel step, user action). Sends an info-level event
   * with message `track:<stepName>`.
   */
  track(stepName: string, attributes?: Record<string, string>): void {
    log("info", `${TRACK_MESSAGE_PREFIX}${stepName}`, attributes);
  },

  /**
   * Get the assigned variant for an experiment. On first call, picks a random variant
   * from `options` and persists the assignment. Future calls return the stored variant
   * (the `options` parameter is ignored after the first assignment).
   */
  getVariant(name: string, options: string[]): string {
    if (experiments[name]) {
      return experiments[name];
    }
    if (options.length === 0) {
      if (config?.debug) {
        console.error(`OwlMetry: getVariant("${name}") called with empty options array`);
      }
      return "";
    }
    const variant = options[Math.floor(Math.random() * options.length)];
    experiments[name] = variant;
    saveExperiments();
    return variant;
  },

  /**
   * Force a specific variant for an experiment. Persists immediately.
   */
  setExperiment(name: string, variant: string): void {
    experiments[name] = variant;
    saveExperiments();
  },

  /**
   * Reset all experiment assignments. Persists immediately.
   */
  clearExperiments(): void {
    experiments = {};
    saveExperiments();
  },

  /**
   * Start a tracked operation. The `metric` slug should contain only lowercase letters,
   * numbers, and hyphens (e.g. "photo-conversion", "api-request"). Invalid characters
   * are auto-corrected with a warning logged in debug mode.
   */
  startOperation(metric: string, attrs?: Record<string, unknown>): Operation {
    return new Operation(log, normalizeSlug(metric), attrs);
  },

  /**
   * Record a single-shot metric. The `metric` slug should contain only lowercase letters,
   * numbers, and hyphens (e.g. "onboarding", "checkout"). Invalid characters are
   * auto-corrected with a warning logged in debug mode.
   */
  recordMetric(metric: string, attrs?: Record<string, unknown>): void {
    log("info", `metric:${normalizeSlug(metric)}:record`, attrs);
  },

  withUser(userId: string): ScopedOwl {
    return new ScopedOwl(userId);
  },

  async flush(): Promise<void> {
    if (transport) await transport.flush();
  },

  wrapHandler<TArgs extends unknown[], TReturn>(
    handler: (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs): Promise<TReturn> => {
      try {
        return await handler(...args);
      } finally {
        await Owl.flush();
      }
    };
  },

  async shutdown(): Promise<void> {
    if (transport) {
      log("info", "sdk:session_ended");
      await transport.shutdown();
      transport = null;
    }
    config = null;
    sessionId = null;
  },
};
