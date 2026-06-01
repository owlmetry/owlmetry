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
export const NOTIFICATION_CHANNELS = ["in_app", "email", "mobile_push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Subset of `NOTIFICATION_CHANNELS` that registers a per-device endpoint via
 * `POST /v1/devices`. `in_app` and `email` deliver without a device row, so
 * they're excluded. Adding a new push channel (Telegram, etc.) means appending
 * here too.
 */
export const PUSH_CHANNELS = ["mobile_push"] as const satisfies readonly NotificationChannel[];
export type PushChannel = (typeof PUSH_CHANNELS)[number];

/**
 * Notification types known to the system. Adding a new type means:
 *   1. Append to this tuple.
 *   2. Add an entry to NOTIFICATION_TYPE_META.
 *   3. Wire a producer call site to dispatcher.enqueue(type, ...).
 *   4. Mirror the new entry in the iOS app's NOTIFICATION_TYPE_SPECS
 *      (owlmetry-ios/Owlmetry/Tabs/Profile/NotificationPreferencesView.swift) —
 *      the iOS preferences screen is hand-maintained, not generated.
 *
 * The web preferences page (apps/web/src/app/dashboard/profile/notifications/
 * page.tsx) renders directly from this map, so it stays in sync automatically;
 * iOS does not, and will silently drop the new type from its UI until updated.
 *
 * `team.invitation` is listed for documentation but never enters the
 * dispatcher — it is sent transactionally via EmailService directly because
 * the recipient may not yet be a user.
 */
export const NOTIFICATION_TYPES = [
  "issue.new",
  "issue.digest",
  "feedback.new",
  "questionnaire.response_new",
  "job.completed",
  "team.invitation",
  "app.rating_changed",
  "app.review_new",
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
    channels: ["in_app", "email", "mobile_push"],
    defaults: { in_app: true, email: false, mobile_push: true },
  },
  "issue.digest": {
    label: "Issue digests",
    description: "Periodic summary of new or regressed issues for your projects.",
    channels: ["in_app", "email", "mobile_push"],
    defaults: { in_app: false, email: true, mobile_push: false },
  },
  "feedback.new": {
    label: "New feedback",
    description: "When a user submits feedback in one of your apps.",
    channels: ["in_app", "email", "mobile_push"],
    defaults: { in_app: true, email: true, mobile_push: true },
  },
  // iOS app: not surfaced in V1 — when iOS questionnaires ship, mirror this
  // entry in NOTIFICATION_TYPE_SPECS so the iOS prefs UI picks it up.
  "questionnaire.response_new": {
    label: "New questionnaire responses",
    description: "When a user submits a questionnaire response in one of your apps. Responses can be high volume; push is opt-in.",
    channels: ["in_app", "email", "mobile_push"],
    defaults: { in_app: true, email: false, mobile_push: false },
  },
  "job.completed": {
    label: "Job completion",
    description: "When a manual job you triggered with --notify finishes. Only the triggering user is notified.",
    channels: ["in_app", "email", "mobile_push"],
    defaults: { in_app: true, email: true, mobile_push: true },
  },
  "app.rating_changed": {
    label: "New ratings",
    description: "When an app's rating count increases on the App Store — i.e., new ratings have appeared.",
    channels: ["in_app", "email", "mobile_push"],
    defaults: { in_app: true, email: false, mobile_push: true },
  },
  "app.review_new": {
    label: "New reviews",
    description: "When new written reviews are pulled from App Store Connect for one of your apps.",
    channels: ["in_app", "email", "mobile_push"],
    defaults: { in_app: true, email: true, mobile_push: true },
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

/** Sparkline windows the dashboard offers on `/dashboard/profile`. */
export const SPARKLINE_WINDOW_DAYS = [7, 14, 30, 60, 90] as const;
export type SparklineWindowDays = (typeof SPARKLINE_WINDOW_DAYS)[number];
export const DEFAULT_SPARKLINE_WINDOW_DAYS: SparklineWindowDays = 30;

/**
 * Trailing windows (in hours) the dashboard header toggle offers for the big
 * magnitude stat tiles (Events / Users / Sessions / Metrics / Funnels /
 * Responses). 1h, 24h, 7d, 30d. Distinct from SPARKLINE_WINDOW_DAYS — the
 * sparklines plot a multi-day trend, these drive the headline counts.
 */
export const MAGNITUDE_WINDOW_HOURS = [1, 24, 168, 720] as const;
export type MagnitudeWindowHours = (typeof MAGNITUDE_WINDOW_HOURS)[number];
export const DEFAULT_MAGNITUDE_WINDOW_HOURS: MagnitudeWindowHours = 24;

export interface UserPreferences {
  version?: 1;
  ui?: {
    columns?: {
      events?: ColumnConfig;
      users?: ColumnConfig;
    };
    dashboard?: {
      /**
       * Trailing-window length (days) for the subtle sparklines on dashboard
       * stat cards. Excludes the current UTC day so partial data never renders
       * as a dip. One of SPARKLINE_WINDOW_DAYS; absent => DEFAULT_SPARKLINE_WINDOW_DAYS.
       */
      sparklineWindowDays?: SparklineWindowDays;
      /**
       * Trailing-window length (hours) for the headline magnitude numbers on the
       * dashboard stat tiles, chosen via the header toggle next to the project
       * picker. One of MAGNITUDE_WINDOW_HOURS; absent => DEFAULT_MAGNITUDE_WINDOW_HOURS.
       */
      magnitudeWindowHours?: MagnitudeWindowHours;
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
 * Top-level shallow merge; column sub-objects (events/users) deep-replace as a
 * unit because the picker always writes the full ordered list. Notification
 * channel maps merge per-channel — the preferences page sends one channel at a
 * time, so a shallow type-level replace would wipe sibling overrides and snap
 * them back to defaults. Used by both the server PATCH handler and the
 * client's optimistic cache update.
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
    if (patch.ui.dashboard !== undefined) {
      merged.ui.dashboard = { ...base.ui?.dashboard, ...patch.ui.dashboard };
    }
  }
  if (patch.notifications !== undefined) {
    merged.notifications = { ...base.notifications };
    if (patch.notifications.types !== undefined) {
      const mergedTypes = { ...base.notifications?.types };
      for (const [type, channels] of Object.entries(patch.notifications.types)) {
        if (channels === undefined) continue;
        mergedTypes[type as NotificationType] = {
          ...mergedTypes[type as NotificationType],
          ...channels,
        };
      }
      merged.notifications.types = mergedTypes;
    }
  }
  return merged;
}

/**
 * Resolve the effective sparkline window from a user's preferences, falling
 * back to the default. Returns one of `SPARKLINE_WINDOW_DAYS`; an invalid
 * stored value (e.g. set by an earlier release) is silently coerced to the
 * default rather than thrown — preferences are read on every dashboard render
 * so a stricter contract isn't worth it.
 */
export function resolveSparklineWindowDays(
  prefs: UserPreferences | null | undefined,
): SparklineWindowDays {
  const stored = prefs?.ui?.dashboard?.sparklineWindowDays;
  if (stored !== undefined && (SPARKLINE_WINDOW_DAYS as readonly number[]).includes(stored)) {
    return stored;
  }
  return DEFAULT_SPARKLINE_WINDOW_DAYS;
}

/**
 * Resolve the effective magnitude-tile window (hours) from a user's
 * preferences, falling back to the default. Like resolveSparklineWindowDays, an
 * invalid stored value is silently coerced to the default.
 */
export function resolveMagnitudeWindowHours(
  prefs: UserPreferences | null | undefined,
): MagnitudeWindowHours {
  const stored = prefs?.ui?.dashboard?.magnitudeWindowHours;
  if (stored !== undefined && (MAGNITUDE_WINDOW_HOURS as readonly number[]).includes(stored)) {
    return stored;
  }
  return DEFAULT_MAGNITUDE_WINDOW_HOURS;
}

/** Compact label for a magnitude window: 1 -> "1h", 24 -> "24h", 168 -> "7d", 720 -> "30d". */
export function formatMagnitudeWindowLabel(hours: MagnitudeWindowHours): string {
  // Keep 24h as hours (it's the default and reads naturally); only collapse
  // multi-day windows to a "Nd" form.
  return hours > 24 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
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
