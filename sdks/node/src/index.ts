import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { validateConfiguration, type ValidatedConfig } from "./configuration.js";
import { Transport } from "./transport.js";
import type { OwlConfiguration, OwlLogLevel, LogEvent } from "./types.js";
import { OwlOperation } from "./operation.js";
import { AttachmentUploader, type OwlAttachment } from "./attachment-uploader.js";

export type { OwlConfiguration, OwlLogLevel, LogEvent } from "./types.js";
export type { OwlAttachment } from "./attachment-uploader.js";
export { OwlOperation } from "./operation.js";

const MAX_ATTRIBUTE_VALUE_LENGTH = 200;
const SLUG_REGEX = /^[a-z0-9-]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSessionId(sessionId: string): string {
  if (!UUID_REGEX.test(sessionId)) {
    throw new Error(
      `OwlMetry: sessionId must be a UUID string (got "${sessionId}"). The server stores session_id as a UUID column — non-UUID values cause ingestion to fail. The Swift SDK's Owl.sessionId is already a UUID, so forward it verbatim.`,
    );
  }
  return sessionId;
}
const STEP_MESSAGE_PREFIX = "step:";
/** @deprecated Legacy prefix — kept for console display of old events */
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
let attachmentUploader: AttachmentUploader | null = null;
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
  level: OwlLogLevel,
  message: string,
  attrs?: Record<string, unknown>,
  userId?: string,
  sessionIdOverride?: string,
): LogEvent {
  return {
    client_event_id: randomUUID(),
    session_id: sessionIdOverride ?? ctx.sessionId,
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

function printToConsole(level: OwlLogLevel, message: string, attrs?: Record<string, unknown>): void {
  if (!config?.consoleLogging) return;
  if (message.startsWith("sdk:")) return;
  if (message.startsWith("metric:") && message.endsWith(":start")) return;

  const tag = level.toUpperCase().padEnd(5);

  let displayMessage: string;
  if (message.startsWith(STEP_MESSAGE_PREFIX)) {
    displayMessage = `step: ${message.slice(STEP_MESSAGE_PREFIX.length)}`;
  } else if (message.startsWith(TRACK_MESSAGE_PREFIX)) {
    // Legacy "track:" prefix from older SDK versions — display as "step:"
    displayMessage = `step: ${message.slice(TRACK_MESSAGE_PREFIX.length)}`;
  } else if (message.startsWith("metric:")) {
    const body = message.slice(7);
    const colonIdx = body.indexOf(":");
    if (colonIdx !== -1) {
      displayMessage = `metric: ${body.slice(0, colonIdx)} ${body.slice(colonIdx + 1)}`;
    } else {
      displayMessage = `metric: ${body}`;
    }
  } else {
    displayMessage = message;
  }

  let line = `🦉 OwlMetry ${tag} ${displayMessage}`;
  if (attrs && Object.keys(attrs).length > 0) {
    const pairs = Object.entries(attrs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    line += ` {${pairs}}`;
  }

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
      break;
  }
}

function log(
  level: OwlLogLevel,
  message: string,
  attrs?: Record<string, unknown>,
  userId?: string,
  attachments?: OwlAttachment[],
  sessionIdOverride?: string,
): void {
  if (sessionIdOverride !== undefined) {
    validateSessionId(sessionIdOverride);
  }
  try {
    const ctx = ensureConfigured();
    printToConsole(level, message, attrs);
    const event = createEvent(ctx, level, message, attrs, userId, sessionIdOverride);
    ctx.transport.enqueue(event);
    if (attachments && attachments.length > 0 && attachmentUploader) {
      attachmentUploader.enqueue(event.client_event_id, event.user_id, ctx.config.isDev, attachments);
    }
  } catch (err) {
    if (config?.debug) {
      console.error("OwlMetry:", err);
    }
  }
}

/**
 * A scoped logger instance that automatically tags a user ID and/or a session ID
 * on every event. Create via `Owl.withUser(userId)` or `Owl.withSession(sessionId)`.
 * Scopes chain: `Owl.withSession(sid).withUser(uid)` and vice versa both work.
 *
 * The session scope is typically used in a server handler to link backend events
 * to a client's session — e.g. read an `X-Owl-Session-Id` header sent by the
 * Swift SDK (`Owl.sessionId`) and scope every event in the handler to that value.
 */
export class ScopedOwl {
  private userId?: string;
  private sessionId?: string;

  constructor(userId?: string, sessionId?: string) {
    this.userId = userId;
    this.sessionId = sessionId;
  }

  /** Return a new scope with the given userId, preserving any existing session scope. */
  withUser(userId: string): ScopedOwl {
    return new ScopedOwl(userId, this.sessionId);
  }

  /**
   * Return a new scope with the given sessionId, preserving any existing user scope.
   * `sessionId` must be a UUID string (as produced by `randomUUID()` or the Swift
   * SDK's `Owl.sessionId`) — non-UUID values throw synchronously.
   */
  withSession(sessionId: string): ScopedOwl {
    return new ScopedOwl(this.userId, validateSessionId(sessionId));
  }

  info(message: string, attrs?: Record<string, unknown>, options?: { attachments?: OwlAttachment[]; sessionId?: string }): void {
    log("info", message, attrs, this.userId, options?.attachments, options?.sessionId ?? this.sessionId);
  }

  debug(message: string, attrs?: Record<string, unknown>, options?: { attachments?: OwlAttachment[]; sessionId?: string }): void {
    log("debug", message, attrs, this.userId, options?.attachments, options?.sessionId ?? this.sessionId);
  }

  warn(message: string, attrs?: Record<string, unknown>, options?: { attachments?: OwlAttachment[]; sessionId?: string }): void {
    log("warn", message, attrs, this.userId, options?.attachments, options?.sessionId ?? this.sessionId);
  }

  error(message: string, attrs?: Record<string, unknown>, options?: { attachments?: OwlAttachment[]; sessionId?: string }): void {
    log("error", message, attrs, this.userId, options?.attachments, options?.sessionId ?? this.sessionId);
  }

  /**
   * Record a named funnel step. Sends an info-level event with message `step:<stepName>`.
   */
  step(stepName: string, attributes?: Record<string, string>): void {
    log("info", `${STEP_MESSAGE_PREFIX}${stepName}`, attributes, this.userId, undefined, this.sessionId);
  }

  /** @deprecated Use `step()` instead. Will be removed in a future version. */
  track(stepName: string, attributes?: Record<string, string>): void {
    this.step(stepName, attributes);
  }

  /**
   * Set custom properties on this user. Properties are merged server-side —
   * existing keys not in this call are preserved. Pass an empty string value
   * to remove a property.
   *
   * Requires a user-scoped instance — throws if the scope has no userId.
   */
  setUserProperties(properties: Record<string, string>): void {
    if (!this.userId) {
      throw new Error("OwlMetry: setUserProperties requires a user-scoped instance. Call .withUser() first.");
    }
    Owl.setUserProperties(this.userId, properties);
  }

  /**
   * Start a tracked operation. The `metric` slug should contain only lowercase letters,
   * numbers, and hyphens (e.g. "photo-conversion", "api-request"). Invalid characters
   * are auto-corrected with a warning logged in debug mode.
   */
  startOperation(metric: string, attrs?: Record<string, unknown>): OwlOperation {
    return new OwlOperation(log, normalizeSlug(metric), attrs, this.userId, this.sessionId);
  }

  /**
   * Record a single-shot metric. The `metric` slug should contain only lowercase letters,
   * numbers, and hyphens (e.g. "onboarding", "checkout"). Invalid characters are
   * auto-corrected with a warning logged in debug mode.
   */
  recordMetric(metric: string, attrs?: Record<string, unknown>): void {
    log("info", `metric:${normalizeSlug(metric)}:record`, attrs, this.userId, undefined, this.sessionId);
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
    attachmentUploader = new AttachmentUploader(config);
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

  info(message: string, attrs?: Record<string, unknown>, options?: { attachments?: OwlAttachment[]; sessionId?: string }): void {
    log("info", message, attrs, undefined, options?.attachments, options?.sessionId);
  },

  debug(message: string, attrs?: Record<string, unknown>, options?: { attachments?: OwlAttachment[]; sessionId?: string }): void {
    log("debug", message, attrs, undefined, options?.attachments, options?.sessionId);
  },

  warn(message: string, attrs?: Record<string, unknown>, options?: { attachments?: OwlAttachment[]; sessionId?: string }): void {
    log("warn", message, attrs, undefined, options?.attachments, options?.sessionId);
  },

  error(message: string, attrs?: Record<string, unknown>, options?: { attachments?: OwlAttachment[]; sessionId?: string }): void {
    log("error", message, attrs, undefined, options?.attachments, options?.sessionId);
  },

  /**
   * Record a named funnel step. Sends an info-level event with message `step:<stepName>`.
   */
  step(stepName: string, attributes?: Record<string, string>): void {
    log("info", `${STEP_MESSAGE_PREFIX}${stepName}`, attributes);
  },

  /** @deprecated Use `step()` instead. Will be removed in a future version. */
  track(stepName: string, attributes?: Record<string, string>): void {
    Owl.step(stepName, attributes);
  },

  /**
   * Set custom properties on a user. Properties are merged server-side —
   * existing keys not in this call are preserved. Pass an empty string value
   * to remove a property.
   */
  setUserProperties(userId: string, properties: Record<string, string>): void {
    try {
      const ctx = ensureConfigured();
      ctx.transport.setUserProperties(userId, properties).catch((err) => {
        if (config?.debug) console.error("OwlMetry: setUserProperties failed", err);
      });
    } catch (err) {
      if (config?.debug) console.error("OwlMetry:", err);
    }
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
  startOperation(metric: string, attrs?: Record<string, unknown>): OwlOperation {
    return new OwlOperation(log, normalizeSlug(metric), attrs);
  },

  /**
   * Record a single-shot metric. The `metric` slug should contain only lowercase letters,
   * numbers, and hyphens (e.g. "onboarding", "checkout"). Invalid characters are
   * auto-corrected with a warning logged in debug mode.
   */
  recordMetric(metric: string, attrs?: Record<string, unknown>): void {
    log("info", `metric:${normalizeSlug(metric)}:record`, attrs);
  },

  /**
   * Return a scoped logger that tags every event with the given userId. The scope
   * can be further narrowed with `.withSession(sessionId)` if needed.
   */
  withUser(userId: string): ScopedOwl {
    return new ScopedOwl(userId);
  },

  /**
   * Return a scoped logger that tags every event with the given sessionId, overriding
   * the SDK's default per-process session ID. Use this in a request handler to link
   * backend events to a client's session — typically by propagating the client's
   * session ID (e.g. Swift SDK `Owl.sessionId`) through a request header.
   *
   * `sessionId` must be a UUID string; non-UUID values throw synchronously. Chainable
   * with `.withUser()`.
   */
  withSession(sessionId: string): ScopedOwl {
    return new ScopedOwl(undefined, validateSessionId(sessionId));
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
