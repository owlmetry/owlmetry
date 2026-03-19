import { gzipSync } from "node:zlib";
import type { ValidatedConfig } from "./configuration.js";
import type { LogEvent, IngestRequest } from "./types.js";

const GZIP_THRESHOLD = 512;
const MAX_BATCH_SIZE = 20;
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

export class Transport {
  private buffer: LogEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: ValidatedConfig;
  private flushing = false;

  constructor(config: ValidatedConfig) {
    this.config = config;
    this.timer = setInterval(() => this.flush(), config.flushIntervalMs);
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
      this.flush();
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

  private async sendBatch(events: LogEvent[]): Promise<void> {
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
  }
}
