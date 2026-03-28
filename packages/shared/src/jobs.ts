export const JOB_TYPES = [
  "db_pruning",
  "soft_delete_cleanup",
  "partition_creation",
  "revenuecat_sync",
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

/**
 * Validates a cron expression string. Returns null if valid, error message if invalid.
 * Standard 5-field: minute hour day-of-month month day-of-week
 */
export function validateCronExpression(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return "Cron expression must have exactly 5 fields (minute hour day month weekday)";
  }

  const ranges: Array<{ name: string; min: number; max: number }> = [
    { name: "minute", min: 0, max: 59 },
    { name: "hour", min: 0, max: 23 },
    { name: "day of month", min: 1, max: 31 },
    { name: "month", min: 1, max: 12 },
    { name: "day of week", min: 0, max: 7 },
  ];

  for (let i = 0; i < 5; i++) {
    const field = fields[i];
    const { name, min, max } = ranges[i];

    if (field === "*") continue;

    // Split on commas for lists (e.g., "1,3,5")
    const parts = field.split(",");
    for (const part of parts) {
      // Handle step values (e.g., "*/2" or "1-5/2")
      const [rangePart, stepStr] = part.split("/");

      if (stepStr !== undefined) {
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step < 1) {
          return `Invalid step value in ${name}: ${part}`;
        }
      }

      if (rangePart === "*") continue;

      // Handle ranges (e.g., "1-5")
      if (rangePart.includes("-")) {
        const [startStr, endStr] = rangePart.split("-");
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
          return `Invalid range in ${name}: ${rangePart} (valid: ${min}-${max})`;
        }
        continue;
      }

      // Single number
      const num = parseInt(rangePart, 10);
      if (isNaN(num) || num < min || num > max) {
        return `Invalid value in ${name}: ${rangePart} (valid: ${min}-${max})`;
      }
    }
  }

  return null;
}
