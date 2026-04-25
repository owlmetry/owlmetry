import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { notifications, userDevices } from "@owlmetry/db";
import type { ApnsClient } from "../../../utils/apns/client.js";
import type { ChannelAdapter, ChannelDeliveryContext, ChannelDeliveryResult } from "../types.js";

/**
 * Sends an iOS APNs push to every user_devices row registered for this user
 * with channel="ios_push". Apple-side revocation (410 Unregistered, 400
 * BadDeviceToken) hard-deletes the offending row so we stop retrying.
 */
export function createIosPushAdapter(apns: ApnsClient): ChannelAdapter {
  return {
    channel: "ios_push",
    async deliver(ctx: ChannelDeliveryContext): Promise<ChannelDeliveryResult> {
      const devices = await ctx.db
        .select({ id: userDevices.id, token: userDevices.token })
        .from(userDevices)
        .where(and(eq(userDevices.user_id, ctx.userId), eq(userDevices.channel, "ios_push")));

      if (devices.length === 0) {
        return { status: "skipped", reason: "no ios_push devices for user" };
      }

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
        devices.map((device) =>
          apns
            .push(device.token, {
              alert: { title: ctx.payload.title, body: ctx.payload.body ?? "" },
              link: ctx.payload.link,
              type: ctx.type,
              notificationId: ctx.notificationId,
              badge: unreadCount,
            })
            .then((result) => ({ device, result })),
        ),
      );

      const deliveredIds: string[] = [];
      const revokedIds: string[] = [];
      let failures = 0;
      let firstError: { statusCode: number; reason: string } | null = null;

      for (const { device, result } of results) {
        if (result.status === "delivered") {
          deliveredIds.push(device.id);
        } else if (result.status === "unregistered" || result.status === "bad_token") {
          revokedIds.push(device.id);
        } else {
          failures++;
          if (!firstError) firstError = { statusCode: result.statusCode, reason: result.reason };
        }
      }

      if (deliveredIds.length > 0) {
        await ctx.db
          .update(userDevices)
          .set({ last_seen_at: new Date() })
          .where(inArray(userDevices.id, deliveredIds));
      }
      if (revokedIds.length > 0) {
        await ctx.db.delete(userDevices).where(inArray(userDevices.id, revokedIds));
      }

      if (deliveredIds.length > 0) {
        return {
          status: "sent",
          metadata: { devices_targeted: devices.length, devices_delivered: deliveredIds.length },
        };
      }

      if (failures === 0) {
        return { status: "skipped", reason: "all device tokens were stale (revoked)" };
      }

      return {
        status: "failed",
        error: firstError ? `apns ${firstError.statusCode}: ${firstError.reason}` : "all pushes failed",
        metadata: { devices_targeted: devices.length, failures },
      };
    },
  };
}
