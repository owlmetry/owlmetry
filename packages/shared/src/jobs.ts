export const JOB_TYPES = [
  "db_pruning",
  "soft_delete_cleanup",
  "partition_creation",
  "revenuecat_sync",
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
    description: "Syncs subscriber data from RevenueCat for all users in a project",
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
      "Resolves stored Apple Search Ads IDs to human-readable names via the Apple Ads Campaign Management API",
    scope: "project",
    default_schedule: null,
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
      "Pulls Apple App Store reviews via the App Store Connect customerReviews API and stores them in app_store_reviews. Requires a configured App Store Connect integration on the project.",
    scope: "project",
    default_schedule: null,
    params: [],
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
