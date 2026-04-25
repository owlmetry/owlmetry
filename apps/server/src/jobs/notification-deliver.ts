import { eq } from "drizzle-orm";
import { notificationDeliveries } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";
import type { NotificationDispatcher } from "../services/notifications/dispatcher.js";

/**
 * Dispatches a single queued delivery row to its channel adapter.
 *
 * Idempotent — the dispatcher early-returns `skipped` if the row is no longer
 * pending. pg-boss handles retries/durability; on transient failures we throw
 * so it picks the job up again.
 */
export function notificationDeliverHandler(dispatcher: NotificationDispatcher): JobHandler {
  return async (ctx, params) => {
    const deliveryId = typeof params.delivery_id === "string" ? params.delivery_id : null;
    if (!deliveryId) {
      return { _silent: true, skipped: "no delivery_id" };
    }

    const result = await dispatcher.runDelivery(deliveryId);

    if (result.status === "sent") {
      await ctx.db
        .update(notificationDeliveries)
        .set({
          status: "sent",
          attempted_at: new Date(),
          attempt_metadata: result.metadata ?? null,
        })
        .where(eq(notificationDeliveries.id, deliveryId));
      return { _silent: true, delivery_id: deliveryId, status: "sent" };
    }

    if (result.status === "skipped") {
      await ctx.db
        .update(notificationDeliveries)
        .set({
          status: "skipped",
          attempted_at: new Date(),
          error: result.reason,
        })
        .where(eq(notificationDeliveries.id, deliveryId));
      return { _silent: true, delivery_id: deliveryId, status: "skipped", reason: result.reason };
    }

    // failed
    await ctx.db
      .update(notificationDeliveries)
      .set({
        status: "failed",
        attempted_at: new Date(),
        error: result.error,
        attempt_metadata: result.metadata ?? null,
      })
      .where(eq(notificationDeliveries.id, deliveryId));
    return { _silent: true, delivery_id: deliveryId, status: "failed", error: result.error };
  };
}
