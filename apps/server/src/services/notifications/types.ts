import type { Db } from "@owlmetry/db";
import type { NotificationChannel, NotificationType } from "@owlmetry/shared";

/**
 * Pre-rendered content the dispatcher writes into the inbox row + hands to
 * channel adapters. `title`/`body` are short summaries; richer formatting per
 * channel (HTML email, push alert) is handled by the adapter.
 */
export interface NotificationPayload {
  title: string;
  body?: string;
  /** Deep link path. e.g. "/dashboard/issues/<id>" — same string for web + iOS. */
  link?: string;
  /** Structured data forwarded to clients for rich rendering and to email adapter for HTML. */
  data?: Record<string, unknown>;
}

export interface EnqueueNotificationInput {
  type: NotificationType;
  /** Recipient user IDs — caller resolves team members / owners. */
  userIds: string[];
  /** Team context for filters in the inbox UI / audit. */
  teamId?: string;
  payload: NotificationPayload;
}

export interface EnqueueNotificationResult {
  /** Inserted inbox row IDs (one per userId). */
  notificationIds: string[];
}

/**
 * Per-recipient context handed to a channel adapter. The adapter only sees one
 * user at a time so it can fail/skip independently per recipient.
 */
export interface ChannelDeliveryContext {
  db: Db;
  notificationId: string;
  deliveryId: string;
  userId: string;
  userEmail: string;
  type: NotificationType;
  payload: NotificationPayload;
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export type ChannelDeliveryResult =
  | { status: "sent"; metadata?: Record<string, unknown> }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; metadata?: Record<string, unknown> };

export interface ChannelAdapter {
  channel: NotificationChannel;
  deliver(ctx: ChannelDeliveryContext): Promise<ChannelDeliveryResult>;
}
