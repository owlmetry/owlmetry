import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { notifications, userDevices } from "@owlmetry/db";
import type { ApnsClient } from "../../../utils/apns/client.js";
import type { ChannelAdapter, ChannelDeliveryContext, ChannelDeliveryResult } from "../types.js";

export interface ApnsClientPair {
  sandbox: ApnsClient;
  production: ApnsClient;
}

/**
 * Sends a push to every user_devices row registered for this user with
 * channel="mobile_push". Routes per-device by `platform`: ios rows go to APNs
 * (sandbox / production picked from the row's environment, declared by the
 * client at registration), android rows are skipped until the FCM transport
 * lands. Apple-side revocation (410 Unregistered, 400 BadDeviceToken)
 * hard-deletes the offending row so we stop retrying.
 */
export function createMobilePushAdapter(clients: ApnsClientPair): ChannelAdapter {
  return {
    channel: "mobile_push",
    async deliver(ctx: ChannelDeliveryContext): Promise<ChannelDeliveryResult> {
      const devices = await ctx.db
        .select({
          id: userDevices.id,
          token: userDevices.token,
          environment: userDevices.environment,
          platform: userDevices.platform,
        })
        .from(userDevices)
        .where(and(eq(userDevices.user_id, ctx.userId), eq(userDevices.channel, "mobile_push")));

      if (devices.length === 0) {
        return { status: "skipped", reason: "no mobile_push devices for user" };
      }

      const iosDevices = devices.filter((d) => d.platform === "ios");
      const androidDevices = devices.filter((d) => d.platform === "android");

      if (iosDevices.length === 0) {
        return {
          status: "skipped",
          reason: `android push not yet implemented (${androidDevices.length} device(s) skipped)`,
        };
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
        iosDevices.map((device) => {
          const client = device.environment === "sandbox" ? clients.sandbox : clients.production;
          return client
            .push(device.token, {
              alert: { title: ctx.payload.title, body: ctx.payload.body ?? "" },
              link: ctx.payload.link,
              type: ctx.type,
              notificationId: ctx.notificationId,
              badge: unreadCount,
            })
            .then((result) => ({ device, result }));
        }),
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
          metadata: {
            devices_targeted: iosDevices.length,
            devices_delivered: deliveredIds.length,
            android_skipped: androidDevices.length,
          },
        };
      }

      if (failures === 0) {
        return { status: "skipped", reason: "all device tokens were stale (revoked)" };
      }

      return {
        status: "failed",
        error: firstError ? `apns ${firstError.statusCode}: ${firstError.reason}` : "all pushes failed",
        metadata: { devices_targeted: iosDevices.length, failures },
      };
    },
  };
}
