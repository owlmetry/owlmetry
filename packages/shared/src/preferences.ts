/**
 * Per-user UI preferences, persisted as JSONB on the `users` row.
 *
 * Kept intentionally open-ended — anything under `ui` is owned by the dashboard
 * and the server merges shallowly at the top level (see PATCH /v1/auth/me) so
 * two tabs editing different sub-objects don't clobber each other.
 *
 * Column model: a single ordered list of visible column ids. A registry id
 * that isn't in `order` is hidden. Adding a new column to the registry later
 * surfaces it in the picker's "Available" bucket for users who have customized
 * (their `order` is defined); users who have never customized keep seeing
 * defaults from code, so new built-in columns show up automatically.
 */

export interface ColumnConfig {
  /** Ordered list of visible column ids; anything not listed is hidden. */
  order: string[];
}

/** Channels a notification can be delivered through. Future-extensible varchar. */
export const NOTIFICATION_CHANNELS = ["in_app", "email", "ios_push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Notification types known to the system. Adding a new type means:
 *   1. Append to this tuple.
 *   2. Add an entry to NOTIFICATION_TYPE_META.
 *   3. Wire a producer call site to dispatcher.enqueue(type, ...).
 *
 * `team.invitation` is listed for documentation but never enters the
 * dispatcher — it is sent transactionally via EmailService directly because
 * the recipient may not yet be a user.
 */
export const NOTIFICATION_TYPES = [
  "issue.new",
  "issue.digest",
  "feedback.new",
  "job.completed",
  "team.invitation",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationTypeMeta {
  label: string;
  description: string;
  /** Channels users can toggle for this type. Empty = transactional / not user-configurable. */
  channels: NotificationChannel[];
  /** Default per-channel enable state for users who haven't customized. */
  defaults: Partial<Record<NotificationChannel, boolean>>;
}

export const NOTIFICATION_TYPE_META: Record<NotificationType, NotificationTypeMeta> = {
  "issue.new": {
    label: "New issues",
    description: "Push as soon as a new or regressed issue is detected by the hourly scan. Bypasses the per-project digest cadence.",
    channels: ["in_app", "email", "ios_push"],
    defaults: { in_app: true, email: false, ios_push: true },
  },
  "issue.digest": {
    label: "Issue digests",
    description: "Periodic summary of new or regressed issues for your projects.",
    channels: ["in_app", "email", "ios_push"],
    defaults: { in_app: true, email: true, ios_push: true },
  },
  "feedback.new": {
    label: "New feedback",
    description: "When a user submits feedback in one of your apps.",
    channels: ["in_app", "email", "ios_push"],
    defaults: { in_app: true, email: true, ios_push: true },
  },
  "job.completed": {
    label: "Job completion",
    description: "When a manual job you triggered with --notify finishes. Only the triggering user is notified.",
    channels: ["in_app", "email", "ios_push"],
    defaults: { in_app: true, email: true, ios_push: false },
  },
  // No "system.alert" type. System job failures (db_pruning, partition_creation,
  // attachment_cleanup, app_version_sync) are server-owner concerns; they keep
  // going to SYSTEM_JOBS_ALERT_EMAIL via direct email and never enter the
  // dispatcher / inbox / push.
  "team.invitation": {
    label: "Team invitations",
    description: "Sent transactionally regardless of preferences.",
    channels: [],
    defaults: {},
  },
};

export interface UserPreferences {
  version?: 1;
  ui?: {
    columns?: {
      events?: ColumnConfig;
      users?: ColumnConfig;
    };
  };
  notifications?: {
    /**
     * Per-type, per-channel overrides. Missing entry => fall back to
     * NOTIFICATION_TYPE_META[type].defaults[channel].
     */
    types?: Partial<Record<NotificationType, Partial<Record<NotificationChannel, boolean>>>>;
  };
}

/**
 * Top-level shallow merge; deep-replace any nested object the patch provides.
 * Two tabs editing different sub-objects (e.g. events vs users column layout)
 * don't clobber each other; same-page last-write-wins. Used by both the
 * server PATCH handler and the client's optimistic cache update.
 */
export function mergeUserPreferences(
  existing: UserPreferences | null | undefined,
  patch: Partial<UserPreferences>,
): UserPreferences {
  const base = existing ?? {};
  const merged: UserPreferences = { ...base };
  if (patch.version !== undefined) merged.version = patch.version;
  if (patch.ui !== undefined) {
    merged.ui = { ...base.ui };
    if (patch.ui.columns !== undefined) {
      merged.ui.columns = { ...base.ui?.columns, ...patch.ui.columns };
    }
  }
  if (patch.notifications !== undefined) {
    merged.notifications = { ...base.notifications };
    if (patch.notifications.types !== undefined) {
      merged.notifications.types = { ...base.notifications?.types, ...patch.notifications.types };
    }
  }
  return merged;
}

/** True iff `order` is element-by-element identical to `defaultOrder`. */
export function isDefaultColumnOrder(order: string[], defaultOrder: string[]): boolean {
  if (order.length !== defaultOrder.length) return false;
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== defaultOrder[i]) return false;
  }
  return true;
}

/**
 * Resolve the effective preference for a (type, channel). Returns true iff the
 * user wants this channel to fire for this notification type. Used by the
 * server-side notification dispatcher and by the client preferences UI to
 * render the current toggle state.
 */
export function isChannelEnabled(
  prefs: UserPreferences | null | undefined,
  type: NotificationType,
  channel: NotificationChannel,
): boolean {
  const override = prefs?.notifications?.types?.[type]?.[channel];
  if (override !== undefined) return override;
  return NOTIFICATION_TYPE_META[type].defaults[channel] ?? false;
}
