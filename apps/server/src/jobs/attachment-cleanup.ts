import { resolve } from "node:path";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { eventAttachments, events } from "@owlmetry/db";
import {
  ATTACHMENT_ORPHAN_GRACE_HOURS,
  ATTACHMENT_SOFT_DELETE_GRACE_DAYS,
} from "@owlmetry/shared";
import type { JobHandler } from "../services/job-runner.js";
import { DiskFileStorage } from "../storage/file-storage.js";
import { config } from "../config.js";

// Attachment cleanup runs daily. It has four jobs, in order:
//   1. Hard-delete rows soft-deleted more than 7 days ago (+ remove files from disk)
//   2. Sweep unfinished uploads older than 24 h (client started but never PUT bytes)
//   3. Remove attachments whose linked event has been retention-pruned AND which are not
//      linked to an issue — these are safe to drop because nobody can reference them.
//   4. Walk the attachments directory looking for files not referenced in the table
//      (disk-first orphans from aborted uploads or manual deletions).
export const attachmentCleanupHandler: JobHandler = async (ctx) => {
  const storage = new DiskFileStorage(config.attachmentsPath);
  const now = new Date();
  const softDeleteCutoff = new Date(
    now.getTime() - ATTACHMENT_SOFT_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000
  );
  const orphanCutoff = new Date(
    now.getTime() - ATTACHMENT_ORPHAN_GRACE_HOURS * 60 * 60 * 1000
  );

  // Step 1: hard-delete soft-deleted rows past their grace period.
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

  // Step 2: incomplete uploads past grace period (reserved but never PUT).
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

  // Step 3: attachments whose event has been pruned AND which are not linked to an issue.
  // We detect pruned events as: event_id IS NOT NULL, event_client_id IS NOT NULL, but the
  // row cannot be found in the events table. (Since events is partitioned, the retention
  // cleanup job drops old partitions, so rows just disappear.) We only touch rows with a
  // populated event_id so we don't accidentally sweep attachments still waiting on a
  // not-yet-arrived event — those are handled by step 2.
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
    .limit(5000);

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

  // Step 4: walk disk for files not referenced by any surviving row.
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
