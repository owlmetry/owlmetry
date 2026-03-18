import { randomUUID } from "node:crypto";
import { validateConfiguration, type ValidatedConfig } from "./configuration.js";
import { Transport } from "./transport.js";
import type { OwlConfiguration, LogLevel, LogEvent } from "./types.js";
import { Operation } from "./operation.js";

export type { OwlConfiguration, LogLevel, LogEvent } from "./types.js";
export { Operation } from "./operation.js";

const MAX_ATTRIBUTE_VALUE_LENGTH = 200;

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
    environment: "backend",
    ...(ctx.config.appVersion ? { app_version: ctx.config.appVersion } : {}),
    is_debug: ctx.config.isDebug,
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

  startOperation(metric: string, attrs?: Record<string, unknown>): Operation {
    return new Operation(log, metric, attrs, this.userId);
  }

  recordMetric(metric: string, attrs?: Record<string, unknown>): void {
    log("info", `metric:${metric}:record`, attrs, this.userId);
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

    if (!beforeExitRegistered) {
      beforeExitRegistered = true;
      process.on("beforeExit", async () => {
        if (transport && transport.bufferSize > 0) {
          await transport.flush();
        }
      });
    }
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

  startOperation(metric: string, attrs?: Record<string, unknown>): Operation {
    return new Operation(log, metric, attrs);
  },

  recordMetric(metric: string, attrs?: Record<string, unknown>): void {
    log("info", `metric:${metric}:record`, attrs);
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
      await transport.shutdown();
      transport = null;
    }
    config = null;
    sessionId = null;
  },
};
