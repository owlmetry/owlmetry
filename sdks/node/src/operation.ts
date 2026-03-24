import { randomUUID } from "node:crypto";

export type LogFn = (level: "info" | "error", message: string, attrs?: Record<string, unknown>, userId?: string) => void;

/**
 * Tracks a metric operation lifecycle (start → complete/fail/cancel).
 * Created by `Owl.startOperation()` or `ScopedOwl.startOperation()`.
 */
export class OwlOperation {
  readonly trackingId: string;
  private metric: string;
  private startTime: number;
  private userId?: string;
  private log: LogFn;

  constructor(log: LogFn, metric: string, attrs?: Record<string, unknown>, userId?: string) {
    this.trackingId = randomUUID();
    this.metric = metric;
    this.startTime = Date.now();
    this.userId = userId;
    this.log = log;

    const startAttrs: Record<string, unknown> = { ...attrs, tracking_id: this.trackingId };
    this.log("info", `metric:${metric}:start`, startAttrs, userId);
  }

  /** Complete the operation successfully. Auto-adds duration_ms. */
  complete(attrs?: Record<string, unknown>): void {
    const combined: Record<string, unknown> = {
      ...attrs,
      tracking_id: this.trackingId,
      duration_ms: String(Date.now() - this.startTime),
    };
    this.log("info", `metric:${this.metric}:complete`, combined, this.userId);
  }

  /** Record a failed operation. Auto-adds duration_ms + error. */
  fail(error: string, attrs?: Record<string, unknown>): void {
    const combined: Record<string, unknown> = {
      ...attrs,
      tracking_id: this.trackingId,
      duration_ms: String(Date.now() - this.startTime),
      error,
    };
    this.log("error", `metric:${this.metric}:fail`, combined, this.userId);
  }

  /** Cancel the operation. Auto-adds duration_ms. */
  cancel(attrs?: Record<string, unknown>): void {
    const combined: Record<string, unknown> = {
      ...attrs,
      tracking_id: this.trackingId,
      duration_ms: String(Date.now() - this.startTime),
    };
    this.log("info", `metric:${this.metric}:cancel`, combined, this.userId);
  }
}
