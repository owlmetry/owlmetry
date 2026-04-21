import { gzipSync } from "node:zlib";
import type { ValidatedConfig } from "./configuration.js";
import type { LogEvent, IngestRequest, FeedbackSubmission, FeedbackReceipt } from "./types.js";

const GZIP_THRESHOLD = 512;
const MAX_BATCH_SIZE = 20;
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

function extractServerError(text: string): string | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON — return raw text.
  }
  return null;
}

export class Transport {
  private buffer: LogEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: ValidatedConfig;
  private flushing = false;

  constructor(config: ValidatedConfig) {
    this.config = config;
    this.timer = setInterval(() => this.flush().catch((err) => this.logError("flush failed", err)), config.flushIntervalMs);
    // Prevent timer from keeping the process alive
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  enqueue(event: LogEvent): void {
    if (this.buffer.length >= this.config.maxBufferSize) {
      // Drop oldest events
      this.buffer.shift();
    }
    this.buffer.push(event);

    if (this.buffer.length >= this.config.flushThreshold) {
      this.flush().catch((err) => this.logError("flush failed", err));
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.flushing) return;
    this.flushing = true;

    try {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, MAX_BATCH_SIZE);
        await this.sendBatch(batch);
      }
    } finally {
      this.flushing = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  get bufferSize(): number {
    return this.buffer.length;
  }

  private logError(message: string, err: unknown): void {
    if (this.config.debug) {
      console.error(`OwlMetry: ${message}`, err);
    }
  }

  async setUserProperties(userId: string, properties: Record<string, string>): Promise<void> {
    const body = JSON.stringify({ user_id: userId, properties });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.config.endpoint}/v1/identity/properties`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (res.ok) return;

        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          if (this.config.debug) {
            const text = await res.text().catch(() => "");
            console.error(`OwlMetry: setUserProperties failed with ${res.status}: ${text}`);
          }
          return;
        }

        if (attempt < MAX_RETRIES) {
          const backoff = Math.min(Math.pow(2, attempt) * 1000, MAX_BACKOFF_MS);
          await new Promise((r) => setTimeout(r, backoff));
        }
      } catch (err) {
        if (this.config.debug) {
          console.error("OwlMetry: network error during setUserProperties", err);
        }
        if (attempt < MAX_RETRIES) {
          const backoff = Math.min(Math.pow(2, attempt) * 1000, MAX_BACKOFF_MS);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }

    if (this.config.debug) {
      console.error(`OwlMetry: setUserProperties failed after ${MAX_RETRIES + 1} attempts`);
    }
  }

  /**
   * Submit a feedback row synchronously. Returns the parsed receipt on success
   * or throws on terminal failure (4xx other than 429, or retries exhausted).
   *
   * Unlike `enqueue` and `setUserProperties`, this is developer-facing — the
   * caller is waiting on the result of a user action, so errors must propagate.
   */
  async submitFeedback(body: FeedbackSubmission): Promise<FeedbackReceipt> {
    const payload = JSON.stringify(body);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.config.endpoint}/v1/feedback`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
          },
          body: payload,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (res.ok) {
          return (await res.json()) as FeedbackReceipt;
        }

        const text = await res.text().catch(() => "");

        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          const serverMessage = extractServerError(text) ?? text;
          throw new Error(
            `OwlMetry: sendFeedback rejected (${res.status})${serverMessage ? `: ${serverMessage}` : ""}`,
          );
        }

        lastError = new Error(
          `OwlMetry: sendFeedback failed with ${res.status}${text ? `: ${text}` : ""}`,
        );
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("OwlMetry: sendFeedback rejected")) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (this.config.debug) {
          console.error("OwlMetry: network error during sendFeedback", err);
        }
      }

      if (attempt < MAX_RETRIES) {
        const backoff = Math.min(Math.pow(2, attempt) * 1000, MAX_BACKOFF_MS);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    throw lastError ?? new Error("OwlMetry: sendFeedback failed after retries");
  }

  private async sendBatch(events: LogEvent[]): Promise<void> {
    try {
      const body: IngestRequest = { events };
      const json = JSON.stringify(body);

      let payload: Uint8Array | string;
      let contentEncoding: string | undefined;

      if (json.length > GZIP_THRESHOLD) {
        payload = new Uint8Array(gzipSync(json));
        contentEncoding = "gzip";
      } else {
        payload = json;
      }

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
          };
          if (contentEncoding) {
            headers["Content-Encoding"] = contentEncoding;
          }

          const res = await fetch(`${this.config.endpoint}/v1/ingest`, {
            method: "POST",
            headers,
            body: payload as BodyInit,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });

          if (res.ok) return;

          // Don't retry client errors (except 429)
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            if (this.config.debug) {
              const text = await res.text().catch(() => "");
              console.error(`OwlMetry: ingest failed with ${res.status}: ${text}`);
            }
            return;
          }

          // Server error or 429 — retry with backoff
          if (attempt < MAX_RETRIES) {
            const backoff = Math.min(Math.pow(2, attempt) * 1000, MAX_BACKOFF_MS);
            await new Promise((r) => setTimeout(r, backoff));
          }
        } catch (err) {
          if (this.config.debug) {
            console.error("OwlMetry: network error during ingest", err);
          }
          if (attempt < MAX_RETRIES) {
            const backoff = Math.min(Math.pow(2, attempt) * 1000, MAX_BACKOFF_MS);
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      }

      if (this.config.debug) {
        console.error(`OwlMetry: failed to send batch after ${MAX_RETRIES + 1} attempts, dropping ${events.length} events`);
      }
    } catch (err) {
      if (this.config.debug) {
        console.error("OwlMetry: failed to prepare batch for sending", err);
      }
    }
  }
}
