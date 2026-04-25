import type { JobRunner } from "../services/job-runner.js";
import type { NotificationDispatcher } from "../services/notifications/dispatcher.js";
import { dbPruningHandler } from "./db-pruning.js";
import { softDeleteCleanupHandler } from "./soft-delete-cleanup.js";
import { partitionCreationHandler } from "./partition-creation.js";
import { revenuecatSyncHandler } from "./revenuecat-sync.js";
import { retentionCleanupHandler } from "./retention-cleanup.js";
import { issueScanHandler } from "./issue-scan.js";
import { issueNotifyHandler } from "./issue-notify.js";
import { attachmentCleanupHandler } from "./attachment-cleanup.js";
import { appleAdsSyncHandler } from "./apple-ads-sync.js";
import { appVersionSyncHandler } from "./app-version-sync.js";
import { notificationDeliverHandler } from "./notification-deliver.js";
import { notificationCleanupHandler } from "./notification-cleanup.js";

export function registerAllJobs(
  runner: JobRunner,
  dispatcher: NotificationDispatcher,
): void {
  runner.register("db_pruning", dbPruningHandler);
  runner.register("soft_delete_cleanup", softDeleteCleanupHandler);
  runner.register("partition_creation", partitionCreationHandler);
  runner.register("revenuecat_sync", revenuecatSyncHandler);
  runner.register("retention_cleanup", retentionCleanupHandler);
  runner.register("issue_scan", issueScanHandler(dispatcher));
  runner.register("issue_notify", issueNotifyHandler(dispatcher));
  runner.register("attachment_cleanup", attachmentCleanupHandler);
  runner.register("apple_ads_sync", appleAdsSyncHandler);
  runner.register("app_version_sync", appVersionSyncHandler);
  runner.register("notification_deliver", notificationDeliverHandler(dispatcher));
  runner.register("notification_cleanup", notificationCleanupHandler);
}
