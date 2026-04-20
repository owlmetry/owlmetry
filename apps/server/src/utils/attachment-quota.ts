import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@owlmetry/db";
import { eventAttachments, projects } from "@owlmetry/db";
import {
  DEFAULT_ATTACHMENT_MAX_FILE_BYTES,
  DEFAULT_ATTACHMENT_PROJECT_QUOTA_BYTES,
} from "@owlmetry/shared";

export interface ResolvedAttachmentLimits {
  maxFileBytes: number;
  projectQuotaBytes: number;
}

export function resolveAttachmentLimits(project: {
  attachment_max_file_bytes: number | null;
  attachment_project_quota_bytes: number | null;
}): ResolvedAttachmentLimits {
  return {
    maxFileBytes:
      project.attachment_max_file_bytes ?? DEFAULT_ATTACHMENT_MAX_FILE_BYTES,
    projectQuotaBytes:
      project.attachment_project_quota_bytes ??
      DEFAULT_ATTACHMENT_PROJECT_QUOTA_BYTES,
  };
}

// Reserved-but-unuploaded rows count against the quota — prevents reserve-loop abuse.
export async function getProjectAttachmentUsage(
  db: Db,
  projectId: string
): Promise<{ usedBytes: number; fileCount: number }> {
  const [row] = await db
    .select({
      used_bytes: sql<string>`coalesce(sum(${eventAttachments.size_bytes}), 0)`,
      file_count: sql<number>`count(*)::int`,
    })
    .from(eventAttachments)
    .where(
      and(
        eq(eventAttachments.project_id, projectId),
        isNull(eventAttachments.deleted_at)
      )
    );
  return {
    usedBytes: Number(row?.used_bytes ?? 0),
    fileCount: row?.file_count ?? 0,
  };
}

export async function getProjectWithAttachmentLimits(db: Db, projectId: string) {
  const [row] = await db
    .select({
      id: projects.id,
      team_id: projects.team_id,
      attachment_max_file_bytes: projects.attachment_max_file_bytes,
      attachment_project_quota_bytes: projects.attachment_project_quota_bytes,
      deleted_at: projects.deleted_at,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}
