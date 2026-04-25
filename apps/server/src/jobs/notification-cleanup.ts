import { and, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { notifications } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";

const READ_RETENTION_DAYS = 30;
const SOFT_DELETED_RETENTION_DAYS = 90;

/**
 * Daily housekeeping for the inbox:
 *  - soft-delete read notifications older than 30 days
 *  - hard-delete soft-deleted notifications older than 90 days (CASCADE drops
 *    their notification_deliveries rows automatically)
 *
 * Counts are returned for the jobs surface; nothing user-visible.
 */
export const notificationCleanupHandler: JobHandler = async (ctx) => {
  const now = Date.now();

  const softDeleteCutoff = new Date(now - READ_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const softDeleted = await ctx.db
    .update(notifications)
    .set({ deleted_at: new Date() })
    .where(
      and(
        isNotNull(notifications.read_at),
        isNull(notifications.deleted_at),
        lt(notifications.read_at, softDeleteCutoff),
      ),
    )
    .returning({ id: notifications.id });

  const hardDeleteCutoff = new Date(now - SOFT_DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const hardDeleted = await ctx.db
    .delete(notifications)
    .where(
      and(
        isNotNull(notifications.deleted_at),
        lt(notifications.deleted_at, hardDeleteCutoff),
      ),
    )
    .returning({ id: notifications.id });

  if (softDeleted.length === 0 && hardDeleted.length === 0) {
    return { _silent: true, soft_deleted: 0, hard_deleted: 0 };
  }

  ctx.log.info(
    `Notification cleanup: soft-deleted ${softDeleted.length}, hard-deleted ${hardDeleted.length}`,
  );
  return {
    soft_deleted: softDeleted.length,
    hard_deleted: hardDeleted.length,
    _silent: true,
  };
};
