import { and, eq, isNull, sql } from "drizzle-orm";
import { notifications, userDevices } from "@owlmetry/db";
import type { ApnsClient } from "../../../utils/apns/client.js";
import type { ChannelAdapter, ChannelDeliveryContext, ChannelDeliveryResult } from "../types.js";

/**
 * Sends an iOS APNs push to every user_devices row registered for this user
 * with channel="ios_push". A single notification → potentially many devices.
 *
 * The aggregate result is `sent` if any device received it, `skipped` if there
 * were no devices, `failed` if every attempt errored. Apple-side revocation
 * (410 Unregistered, 400 BadDeviceToken) hard-deletes the offending row so we
 * stop retrying it.
 */
export function createIosPushAdapter(apns: ApnsClient): ChannelAdapter {
  return {
    channel: "ios_push",
    async deliver(ctx: ChannelDeliveryContext): Promise<ChannelDeliveryResult> {
      const devices = await ctx.db
        .select({
          id: userDevices.id,
          token: userDevices.token,
        })
        .from(userDevices)
        .where(and(eq(userDevices.user_id, ctx.userId), eq(userDevices.channel, "ios_push")));

      if (devices.length === 0) {
        return { status: "skipped", reason: "no ios_push devices for user" };
      }

      // Compute current unread badge for the user (excludes soft-deleted).
      const [{ count: unreadCount }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.user_id, ctx.userId),
            isNull(notifications.read_at),
            isNull(notifications.deleted_at),
          ),
        );

      const results = await Promise.all(
        devices.map(async (device) => {
          const result = await apns.push(device.token, {
            alert: {
              title: ctx.payload.title,
              body: ctx.payload.body ?? "",
            },
            link: ctx.payload.link,
            type: ctx.type,
            notificationId: ctx.notificationId,
            badge: unreadCount,
          });

          if (result.status === "unregistered" || result.status === "bad_token") {
            await ctx.db.delete(userDevices).where(eq(userDevices.id, device.id));
          } else if (result.status === "delivered") {
            await ctx.db
              .update(userDevices)
              .set({ last_seen_at: new Date() })
              .where(eq(userDevices.id, device.id));
          }
          return result;
        }),
      );

      const delivered = results.filter((r) => r.status === "delivered");
      const failures = results.filter((r) => r.status === "error");

      if (delivered.length > 0) {
        return {
          status: "sent",
          metadata: {
            devices_targeted: devices.length,
            devices_delivered: delivered.length,
            apns_ids: delivered.map((d) => (d.status === "delivered" ? d.apnsId : null)),
          },
        };
      }

      if (failures.length === 0) {
        return { status: "skipped", reason: "all device tokens were stale (revoked)" };
      }

      const firstError = failures[0];
      return {
        status: "failed",
        error:
          firstError.status === "error"
            ? `apns ${firstError.statusCode}: ${firstError.reason}`
            : "all pushes failed",
        metadata: { devices_targeted: devices.length, failures: failures.length },
      };
    },
  };
}
