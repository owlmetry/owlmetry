import { and, isNull, lt, sql } from "drizzle-orm";
import { questionnaireResponses } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";

// 90 days is long enough that a user who answered Q1 and bailed can still
// resume two months later, short enough to bound the orphan set. Tunable per
// install if abandonment patterns prove otherwise.
const DRAFT_RETENTION_DAYS = 90;

/**
 * Daily housekeeping for abandoned questionnaire drafts:
 * soft-delete rows where submitted_at IS NULL AND updated_at < now() - 90 days.
 *
 * Drafts are first-class responses in the read path (they show up in lists
 * and analytics so abandonment is visible), but a draft that hasn't been
 * touched in three months is effectively a dead session — the user
 * presumably uninstalled, switched devices, or just moved on. Soft-delete
 * keeps the row recoverable for 7 days; the shared `cleanupSoftDeletedResources`
 * step run by `soft_delete_cleanup` hard-deletes any `questionnaire_responses`
 * with `deleted_at` older than that. Two-stage retention with one cron entry
 * here and one shared hard-delete sweep.
 */
export const questionnaireDraftCleanupHandler: JobHandler = async (ctx) => {
  const cutoff = new Date(Date.now() - DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const softDeleted = await ctx.db
    .update(questionnaireResponses)
    .set({ deleted_at: new Date() })
    .where(
      and(
        isNull(questionnaireResponses.submitted_at),
        isNull(questionnaireResponses.deleted_at),
        lt(questionnaireResponses.updated_at, cutoff),
      ),
    )
    .returning({ id: questionnaireResponses.id });

  if (softDeleted.length === 0) {
    return { _silent: true, soft_deleted: 0 };
  }

  ctx.log.info(
    `Questionnaire draft cleanup: soft-deleted ${softDeleted.length} abandoned drafts (older than ${DRAFT_RETENTION_DAYS}d)`,
  );
  return {
    soft_deleted: softDeleted.length,
  };
};
