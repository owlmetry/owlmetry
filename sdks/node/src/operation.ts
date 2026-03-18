import { randomUUID } from "node:crypto";

/** Internal reference to the log function, set by the SDK on first use. */
let logFn: ((level: "info" | "error", message: string, attrs?: Record<string, unknown>, userId?: string) => void) | null = null;

/** @internal Called by the SDK module to wire up the log function. */
export function _setLogFn(fn: typeof logFn): void {
  logFn = fn;
}

/**
 * Tracks a metric operation lifecycle (start → complete/fail/cancel).
 * Created by `Owl.startOperation()` or `ScopedOwl.startOperation()`.
 */
export class Operation {
  readonly trackingId: string;
  private metric: string;
  private startTime: number;
  private userId?: string;

  constructor(metric: string, attrs?: Record<string, unknown>, userId?: string) {
    this.trackingId = randomUUID();
    this.metric = metric;
    this.startTime = Date.now();
    this.userId = userId;

    const startAttrs: Record<string, unknown> = { ...attrs, tracking_id: this.trackingId };
    logFn?.("info", `metric:${metric}:start`, startAttrs, userId);
  }

  /** Complete the operation successfully. Auto-adds duration_ms. */
  complete(attrs?: Record<string, unknown>): void {
    const combined: Record<string, unknown> = {
      ...attrs,
      tracking_id: this.trackingId,
      duration_ms: String(Date.now() - this.startTime),
    };
    logFn?.("info", `metric:${this.metric}:complete`, combined, this.userId);
  }

  /** Record a failed operation. Auto-adds duration_ms + error. */
  fail(error: string, attrs?: Record<string, unknown>): void {
    const combined: Record<string, unknown> = {
      ...attrs,
      tracking_id: this.trackingId,
      duration_ms: String(Date.now() - this.startTime),
      error,
    };
    logFn?.("error", `metric:${this.metric}:fail`, combined, this.userId);
  }

  /** Cancel the operation. Auto-adds duration_ms. */
  cancel(attrs?: Record<string, unknown>): void {
    const combined: Record<string, unknown> = {
      ...attrs,
      tracking_id: this.trackingId,
      duration_ms: String(Date.now() - this.startTime),
    };
    logFn?.("info", `metric:${this.metric}:cancel`, combined, this.userId);
  }
}
