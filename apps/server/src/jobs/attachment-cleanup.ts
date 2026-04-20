import { resolve } from "node:path";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { eventAttachments, events } from "@owlmetry/db";
import {
  ATTACHMENT_ORPHAN_GRACE_HOURS,
  ATTACHMENT_ORPHAN_SWEEP_BATCH_SIZE,
  ATTACHMENT_SOFT_DELETE_GRACE_DAYS,
} from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";
import { attachmentStorage } from "../storage/index.js";

export const attachmentCleanupHandler: JobHandler = async (ctx) => {
  const storage = attachmentStorage;
  const now = new Date();
  const softDeleteCutoff = new Date(
    now.getTime() - ATTACHMENT_SOFT_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000
  );
  const orphanCutoff = new Date(
    now.getTime() - ATTACHMENT_ORPHAN_GRACE_HOURS * 60 * 60 * 1000
  );

  const softDeleted = await ctx.db
    .select({ id: eventAttachments.id, storage_path: eventAttachments.storage_path })
    .from(eventAttachments)
    .where(
      and(
        isNotNull(eventAttachments.deleted_at),
        lt(eventAttachments.deleted_at, softDeleteCutoff)
      )
    );

  let softDeletedRemoved = 0;
  for (const row of softDeleted) {
    if (ctx.isCancelled()) break;
    if (row.storage_path) {
      await storage.delete(row.storage_path).catch((err) => {
        ctx.log.warn({ err, id: row.id }, "failed to remove soft-deleted attachment file");
      });
    }
    await ctx.db.delete(eventAttachments).where(eq(eventAttachments.id, row.id));
    softDeletedRemoved++;
  }

  const incompleteOrphans = await ctx.db
    .select({ id: eventAttachments.id, storage_path: eventAttachments.storage_path })
    .from(eventAttachments)
    .where(
      and(
        isNull(eventAttachments.uploaded_at),
        lt(eventAttachments.created_at, orphanCutoff),
        isNull(eventAttachments.deleted_at)
      )
    );

  let incompleteRemoved = 0;
  for (const row of incompleteOrphans) {
    if (ctx.isCancelled()) break;
    if (row.storage_path) {
      await storage.delete(row.storage_path).catch(() => {});
    }
    await ctx.db.delete(eventAttachments).where(eq(eventAttachments.id, row.id));
    incompleteRemoved++;
  }

  // Pruned event ⇒ attachment.event_id is set but the row is gone from the partitioned
  // events table. Only sweep those without an issue link (issue_id preserves them).
  const candidateOrphans = await ctx.db
    .select({
      id: eventAttachments.id,
      event_id: eventAttachments.event_id,
      storage_path: eventAttachments.storage_path,
    })
    .from(eventAttachments)
    .where(
      and(
        isNull(eventAttachments.issue_id),
        isNull(eventAttachments.deleted_at),
        isNotNull(eventAttachments.event_id),
        isNotNull(eventAttachments.uploaded_at),
        lt(eventAttachments.created_at, orphanCutoff)
      )
    )
    .limit(ATTACHMENT_ORPHAN_SWEEP_BATCH_SIZE);

  const orphanEventIds = candidateOrphans
    .map((c) => c.event_id)
    .filter((id): id is string => !!id);
  const prunedEventIds = new Set<string>(orphanEventIds);
  if (orphanEventIds.length > 0) {
    const stillPresent = await ctx.db
      .select({ id: events.id })
      .from(events)
      .where(sql`${events.id} = ANY(${orphanEventIds}::uuid[])`);
    for (const row of stillPresent) {
      if (row.id) prunedEventIds.delete(row.id);
    }
  }

  let prunedEventAttachmentsRemoved = 0;
  for (const row of candidateOrphans) {
    if (ctx.isCancelled()) break;
    if (!row.event_id || !prunedEventIds.has(row.event_id)) continue;
    if (row.storage_path) {
      await storage.delete(row.storage_path).catch(() => {});
    }
    await ctx.db.delete(eventAttachments).where(eq(eventAttachments.id, row.id));
    prunedEventAttachmentsRemoved++;
  }

  const knownPathRows = await ctx.db
    .select({ storage_path: eventAttachments.storage_path })
    .from(eventAttachments)
    .where(isNotNull(eventAttachments.storage_path));
  const known = new Set<string>();
  for (const r of knownPathRows) {
    if (r.storage_path) {
      known.add(r.storage_path);
      known.add(resolve(r.storage_path));
    }
  }

  let diskOrphansRemoved = 0;
  try {
    for await (const file of storage.listOrphans(known)) {
      if (ctx.isCancelled()) break;
      await storage.delete(file).catch(() => {});
      diskOrphansRemoved++;
    }
  } catch (err) {
    ctx.log.warn({ err }, "disk orphan sweep failed");
  }

  const total =
    softDeletedRemoved +
    incompleteRemoved +
    prunedEventAttachmentsRemoved +
    diskOrphansRemoved;
  if (total > 0) {
    ctx.log.info(
      `Attachment cleanup: ${softDeletedRemoved} soft-deleted, ${incompleteRemoved} incomplete, ${prunedEventAttachmentsRemoved} pruned-event, ${diskOrphansRemoved} disk orphans`
    );
  }

  return {
    soft_deleted_removed: softDeletedRemoved,
    incomplete_removed: incompleteRemoved,
    pruned_event_attachments_removed: prunedEventAttachmentsRemoved,
    disk_orphans_removed: diskOrphansRemoved,
    _silent: total === 0,
  };
};
