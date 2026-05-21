export const JOB_TYPES = [
  "db_pruning",
  "soft_delete_cleanup",
  "partition_creation",
  "revenuecat_sync",
  "revenuecat_user_backfill",
  "retention_cleanup",
  "issue_scan",
  "issue_notify",
  "attachment_cleanup",
  "apple_ads_sync",
  "app_version_sync",
  "app_store_ratings_sync",
  "app_store_connect_reviews_sync",
  "notification_deliver",
  "notification_cleanup",
  "questionnaire_draft_cleanup",
  "stats_aggregate_daily",
  "stats_aggregate_hourly",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobProgress {
  processed: number;
  total: number;
  message?: string;
}

export type JobSchedule = string | null;

export interface JobParamDef {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
}

export const JOB_TYPE_META: Record<
  JobType,
  {
    label: string;
    description: string;
    scope: "system" | "project";
    default_schedule: JobSchedule;
    params: JobParamDef[];
  }
> = {
  db_pruning: {
    label: "Database Pruning",
    description: "Drops oldest event partitions when database exceeds size limit",
    scope: "system",
    default_schedule: "0 * * * *",
    params: [],
  },
  soft_delete_cleanup: {
    label: "Soft-Delete Cleanup",
    description: "Hard-deletes resources soft-deleted more than 7 days ago",
    scope: "system",
    default_schedule: "0 3 * * *",
    params: [],
  },
  partition_creation: {
    label: "Partition Creation",
    description: "Creates monthly partitions for event tables",
    scope: "system",
    default_schedule: "0 4 * * *",
    params: [],
  },
  revenuecat_sync: {
    label: "RevenueCat Sync",
    description:
      "Syncs subscriber data from RevenueCat (subscriptions, entitlements, attribution, lifetime USD revenue). With no project_id, fans out across every project that has an active RevenueCat integration. With project_id set, syncs that single project only (manual-trigger path).",
    scope: "system",
    default_schedule: "0 3 * * *",
    params: [
      {
        name: "project_id",
        description:
          "Sync only the given project instead of fanning out across all projects with an active RevenueCat integration",
        type: "string",
        required: false,
      },
    ],
  },
  revenuecat_user_backfill: {
    label: "RevenueCat User Backfill",
    description:
      "Pages through every customer in the linked RevenueCat project and creates or updates the corresponding app_users row (subscription state, lifetime USD revenue, attribution). Idempotent — re-running is safe. Anonymous RevenueCat IDs ($RCAnonymousID:*) are skipped. Can take hours on large projects (~3 RC API calls per customer at the 480 req/min Customer Information budget).",
    scope: "project",
    default_schedule: null,
    params: [],
  },
  retention_cleanup: {
    label: "Data Retention Cleanup",
    description:
      "Deletes events, metric events, and funnel events older than each project's retention policy",
    scope: "system",
    default_schedule: "0 2 * * *",
    params: [],
  },
  issue_scan: {
    label: "Issue Scan",
    description: "Scans error events and creates/updates issues with deduplication",
    scope: "system",
    default_schedule: "0 * * * *",
    params: [],
  },
  issue_notify: {
    label: "Issue Notification",
    description: "Sends issue digest emails per project alert settings",
    scope: "system",
    default_schedule: "5 * * * *",
    params: [],
  },
  attachment_cleanup: {
    label: "Attachment Cleanup",
    description:
      "Removes soft-deleted event attachments, sweeps orphans, and deletes files whose events have been retention-pruned",
    scope: "system",
    default_schedule: "0 5 * * *",
    params: [],
  },
  apple_ads_sync: {
    label: "Apple Ads Sync",
    description:
      "Resolves stored Apple Search Ads IDs to readable names AND syncs campaign + ad-group spend / impressions / taps / installs from the Reports API into ad_campaign_lifetime + ad_adgroup_lifetime (filtered by adamId so each project only stores rows for its own apps). Project-scoped: trigger from the dashboard or via POST /v1/projects/:id/ads/sync. The daily 04:45 UTC cron fires the same handler with no project_id, which fans out across every project that has an active Apple Search Ads integration.",
    scope: "project",
    default_schedule: "45 4 * * *",
    params: [],
  },
  app_version_sync: {
    label: "App Version Sync",
    description:
      "Refreshes latest_app_version and the numeric Apple App Store ID per app from the Apple App Store iTunes Lookup (for Apple apps with a bundle_id), or computes the version from production events (Android/Web/Backend)",
    scope: "system",
    default_schedule: "15 * * * *",
    params: [
      {
        name: "app_id",
        description: "Sync only the given app instead of all apps",
        type: "string",
        required: false,
      },
    ],
  },
  app_store_ratings_sync: {
    label: "App Store Ratings Sync",
    description:
      "Fans out across every Apple iTunes storefront for each Apple app with a bundle_id, recording per-country average rating and rating count as a daily snapshot in app_store_ratings, then refreshing the worldwide-cache columns on apps.",
    scope: "system",
    default_schedule: "30 4 * * *",
    params: [
      {
        name: "app_id",
        description: "Sync only the given app instead of all apps",
        type: "string",
        required: false,
      },
      {
        name: "project_id",
        description: "Sync only apps within the given project",
        type: "string",
        required: false,
      },
    ],
  },
  app_store_connect_reviews_sync: {
    label: "App Store Connect Reviews Sync",
    description:
      "Pulls Apple App Store reviews via the App Store Connect customerReviews API and stores them in app_store_reviews. With no project_id, fans out across every project that has an active App Store Connect integration. With project_id set, syncs that single project only (manual-trigger path).",
    scope: "system",
    default_schedule: "30 5 * * *",
    params: [
      {
        name: "project_id",
        description: "Sync only the given project instead of fanning out across all projects with an active App Store Connect integration",
        type: "string",
        required: false,
      },
    ],
  },
  notification_deliver: {
    label: "Notification Delivery",
    description:
      "Delivers a single queued notification to one external channel (email, mobile push). One job per pending row in notification_deliveries.",
    scope: "system",
    default_schedule: null,
    params: [
      {
        name: "delivery_id",
        description: "ID of the notification_deliveries row to dispatch",
        type: "string",
        required: true,
      },
    ],
  },
  notification_cleanup: {
    label: "Notification Cleanup",
    description:
      "Soft-deletes read notifications older than 30 days; hard-deletes soft-deleted notifications older than 90 days.",
    scope: "system",
    default_schedule: "0 6 * * *",
    params: [],
  },
  questionnaire_draft_cleanup: {
    label: "Questionnaire Draft Cleanup",
    description:
      "Soft-deletes abandoned questionnaire drafts (submitted_at IS NULL, untouched > 90 days). 90d is long enough to let a user resume across a long gap, short enough to bound the orphan set when sessions never finish.",
    scope: "system",
    default_schedule: "30 6 * * *",
    params: [],
  },
  stats_aggregate_daily: {
    label: "Daily Stats Aggregation",
    description:
      "Aggregates counts (events / metric_events / funnel_events / questionnaire_responses) into the *_daily rollup tables for one or more UTC days. With no params, re-aggregates the trailing 3 days for every project (catches late-arriving SDK events). With `start`/`end` (YYYY-MM-DD), iterates that date range — used for one-time backfills. Optional `project_id` narrows to a single project. Writes per-app rows AND a project-level rollup row (app_id NULL) so card reads hit a single row, never a SUM. Anonymous counts; tables are explicitly excluded from retention pruning.",
    scope: "system",
    default_schedule: "30 0 * * *",
    params: [
      {
        name: "start",
        description: "Backfill start day (YYYY-MM-DD, UTC). Required together with `end`.",
        type: "string",
        required: false,
      },
      {
        name: "end",
        description: "Backfill end day inclusive (YYYY-MM-DD, UTC). Required together with `start`.",
        type: "string",
        required: false,
      },
      {
        name: "project_id",
        description: "Aggregate only the given project instead of fanning out across all projects.",
        type: "string",
        required: false,
      },
    ],
  },
  stats_aggregate_hourly: {
    label: "Hourly Stats Aggregation",
    description:
      "Hourly analog of stats_aggregate_daily — writes into the *_hourly rollup tables. With no params, re-aggregates the trailing 3 hours for every project. With `start`/`end` (ISO hour like 2026-05-20T00:00), iterates that hour range. Optional `project_id` narrows scope.",
    scope: "system",
    default_schedule: "5 * * * *",
    params: [
      {
        name: "start",
        description:
          "Backfill start hour (ISO 8601, UTC; e.g. 2026-05-20T00:00:00Z). Required together with `end`.",
        type: "string",
        required: false,
      },
      {
        name: "end",
        description: "Backfill end hour inclusive. Required together with `start`.",
        type: "string",
        required: false,
      },
      {
        name: "project_id",
        description: "Aggregate only the given project instead of fanning out across all projects.",
        type: "string",
        required: false,
      },
    ],
  },
};

export interface JobRunResponse {
  id: string;
  job_type: string;
  status: JobStatus;
  team_id: string | null;
  project_id: string | null;
  triggered_by: string;
  params: Record<string, unknown> | null;
  progress: JobProgress | null;
  result: Record<string, unknown> | null;
  error: string | null;
  notify: boolean;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface JobRunsQueryParams {
  job_type?: string;
  status?: string;
  project_id?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: string;
}

export interface JobRunsResponse {
  job_runs: JobRunResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface TriggerJobRequest {
  job_type: string;
  project_id?: string;
  params?: Record<string, unknown>;
  notify?: boolean;
}

export interface TriggerJobResponse {
  job_run: JobRunResponse;
}
