import { eq, inArray } from "drizzle-orm";
import { users, notifications, notificationDeliveries } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import {
  NOTIFICATION_CHANNELS,
  isChannelEnabled,
  type NotificationChannel,
} from "@owlmetry/shared";
import type { JobRunner } from "../job-runner.js";
import type {
  ChannelAdapter,
  ChannelDeliveryContext,
  ChannelDeliveryResult,
  EnqueueNotificationInput,
  EnqueueNotificationResult,
} from "./types.js";

interface DispatcherOptions {
  db: Db;
  jobRunner: JobRunner;
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  adapters: ChannelAdapter[];
}

/**
 * Owns the per-user fan-out and channel pref evaluation. Producers call
 * `enqueue()` with a notification type, recipient user IDs, and a pre-rendered
 * payload. The dispatcher writes inbox rows synchronously and queues async
 * delivery jobs for non-`in_app` channels via pg-boss.
 *
 * No knowledge of channel internals lives outside the adapters — adding
 * Telegram / Android push / Slack means dropping in a new ChannelAdapter and
 * extending NOTIFICATION_CHANNELS. No producer change required.
 */
export class NotificationDispatcher {
  private adapters: Map<NotificationChannel, ChannelAdapter>;

  constructor(private opts: DispatcherOptions) {
    this.adapters = new Map(opts.adapters.map((a) => [a.channel, a]));
  }

  async enqueue(input: EnqueueNotificationInput): Promise<EnqueueNotificationResult> {
    const result: EnqueueNotificationResult = {
      notificationIds: [],
      pendingDeliveryIds: [],
    };
    if (input.userIds.length === 0) return result;

    // Dedupe + load user prefs in one query
    const uniqueUserIds = Array.from(new Set(input.userIds));
    const userRows = await this.opts.db
      .select({ id: users.id, email: users.email, preferences: users.preferences })
      .from(users)
      .where(inArray(users.id, uniqueUserIds));

    if (userRows.length === 0) return result;

    for (const user of userRows) {
      // Insert inbox row for this user
      const [notif] = await this.opts.db
        .insert(notifications)
        .values({
          user_id: user.id,
          team_id: input.teamId ?? null,
          type: input.type,
          title: input.payload.title,
          body: input.payload.body ?? null,
          link: input.payload.link ?? null,
          data: input.payload.data ?? {},
        })
        .returning({ id: notifications.id });

      result.notificationIds.push(notif.id);

      // Decide which channels fire for this user
      for (const channel of NOTIFICATION_CHANNELS) {
        const enabled = isChannelEnabled(user.preferences, input.type, channel);
        if (!enabled) continue;

        if (channel === "in_app") {
          // The inbox row IS the in-app delivery — record it as already sent.
          await this.opts.db.insert(notificationDeliveries).values({
            notification_id: notif.id,
            channel: "in_app",
            status: "sent",
            attempted_at: new Date(),
          });
          continue;
        }

        // Skip channels with no registered adapter (e.g. APNs unconfigured).
        if (!this.adapters.has(channel)) continue;

        const [delivery] = await this.opts.db
          .insert(notificationDeliveries)
          .values({
            notification_id: notif.id,
            channel,
            status: "pending",
          })
          .returning({ id: notificationDeliveries.id });

        result.pendingDeliveryIds.push(delivery.id);

        // Queue async dispatch (server may restart — we want pg-boss durability).
        this.opts.jobRunner
          .trigger("notification_deliver", {
            triggeredBy: "schedule:notifications",
            params: { delivery_id: delivery.id },
          })
          .catch((err) => {
            this.opts.log.error(err, `Failed to queue notification delivery ${delivery.id}`);
          });
      }
    }

    return result;
  }

  /**
   * Called by the `notification_deliver` job handler — runs the right adapter
   * for one delivery row. Handler is responsible for marking the delivery
   * status, not the dispatcher.
   */
  async runDelivery(deliveryId: string): Promise<ChannelDeliveryResult> {
    const [delivery] = await this.opts.db
      .select({
        id: notificationDeliveries.id,
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        notification_id: notificationDeliveries.notification_id,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId))
      .limit(1);

    if (!delivery) {
      return { status: "skipped", reason: "delivery row not found" };
    }
    if (delivery.status !== "pending") {
      return { status: "skipped", reason: `already ${delivery.status}` };
    }

    const [notif] = await this.opts.db
      .select({
        id: notifications.id,
        user_id: notifications.user_id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        data: notifications.data,
      })
      .from(notifications)
      .where(eq(notifications.id, delivery.notification_id))
      .limit(1);

    if (!notif) {
      return { status: "skipped", reason: "notification row missing" };
    }

    const [user] = await this.opts.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, notif.user_id))
      .limit(1);

    if (!user) {
      return { status: "skipped", reason: "user missing" };
    }

    const adapter = this.adapters.get(delivery.channel as NotificationChannel);
    if (!adapter) {
      return { status: "skipped", reason: `no adapter for channel '${delivery.channel}'` };
    }

    const ctx: ChannelDeliveryContext = {
      db: this.opts.db,
      notificationId: notif.id,
      deliveryId: delivery.id,
      userId: notif.user_id,
      userEmail: user.email,
      type: notif.type as ChannelDeliveryContext["type"],
      payload: {
        title: notif.title,
        body: notif.body ?? undefined,
        link: notif.link ?? undefined,
        data: (notif.data ?? {}) as Record<string, unknown>,
      },
      log: this.opts.log,
    };

    return adapter.deliver(ctx);
  }
}
