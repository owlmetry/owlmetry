import { eq } from "drizzle-orm";
import { notificationDeliveries } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";
import type { NotificationDispatcher } from "../services/notifications/dispatcher.js";

/**
 * Idempotent: dispatcher.runDelivery early-returns `skipped` if the row is
 * no longer pending. Transient adapter failures throw → pg-boss retries.
 */
export function notificationDeliverHandler(dispatcher: NotificationDispatcher): JobHandler {
  return async (ctx, params) => {
    const deliveryId = typeof params.delivery_id === "string" ? params.delivery_id : null;
    if (!deliveryId) return { _silent: true, skipped: "no delivery_id" };

    const result = await dispatcher.runDelivery(deliveryId);

    await ctx.db
      .update(notificationDeliveries)
      .set({
        status: result.status,
        attempted_at: new Date(),
        error: result.status === "skipped" ? result.reason : result.status === "failed" ? result.error : null,
        attempt_metadata: "metadata" in result ? result.metadata ?? null : null,
      })
      .where(eq(notificationDeliveries.id, deliveryId));

    return { _silent: true, delivery_id: deliveryId, status: result.status };
  };
}
