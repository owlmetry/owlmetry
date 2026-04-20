import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@owlmetry/db";
import { eventAttachments, projects } from "@owlmetry/db";
import {
  DEFAULT_ATTACHMENT_PROJECT_QUOTA_BYTES,
  DEFAULT_ATTACHMENT_USER_QUOTA_BYTES,
} from "@owlmetry/shared";

export interface ResolvedAttachmentLimits {
  projectQuotaBytes: number;
  userQuotaBytes: number;
}

export function resolveAttachmentLimits(project: {
  attachment_user_quota_bytes: number | null;
  attachment_project_quota_bytes: number | null;
}): ResolvedAttachmentLimits {
  return {
    projectQuotaBytes:
      project.attachment_project_quota_bytes ??
      DEFAULT_ATTACHMENT_PROJECT_QUOTA_BYTES,
    userQuotaBytes:
      project.attachment_user_quota_bytes ??
      DEFAULT_ATTACHMENT_USER_QUOTA_BYTES,
  };
}

export interface AttachmentUsageRow {
  usedBytes: number;
  fileCount: number;
}

// Reserved-but-unuploaded rows count against the quota — prevents reserve-loop abuse.
// When userId is provided, returns both project-wide and user-scoped usage in a single
// scan (via FILTER clause) so the ingest hot path doesn't need two round-trips.
export async function getAttachmentUsage(
  db: Db,
  projectId: string,
  userId?: string
): Promise<{ project: AttachmentUsageRow; user: AttachmentUsageRow | null }> {
  const [row] = await db
    .select({
      project_bytes: sql<string>`coalesce(sum(${eventAttachments.size_bytes}), 0)`,
      project_count: sql<number>`count(*)::int`,
      user_bytes: userId
        ? sql<string>`coalesce(sum(${eventAttachments.size_bytes}) filter (where ${eventAttachments.user_id} = ${userId}), 0)`
        : sql<string>`'0'`,
      user_count: userId
        ? sql<number>`count(*) filter (where ${eventAttachments.user_id} = ${userId})::int`
        : sql<number>`0`,
    })
    .from(eventAttachments)
    .where(
      and(
        eq(eventAttachments.project_id, projectId),
        isNull(eventAttachments.deleted_at)
      )
    );
  return {
    project: {
      usedBytes: Number(row?.project_bytes ?? 0),
      fileCount: row?.project_count ?? 0,
    },
    user: userId
      ? {
          usedBytes: Number(row?.user_bytes ?? 0),
          fileCount: row?.user_count ?? 0,
        }
      : null,
  };
}

export async function getProjectWithAttachmentLimits(db: Db, projectId: string) {
  const [row] = await db
    .select({
      id: projects.id,
      team_id: projects.team_id,
      attachment_user_quota_bytes: projects.attachment_user_quota_bytes,
      attachment_project_quota_bytes: projects.attachment_project_quota_bytes,
      deleted_at: projects.deleted_at,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}
