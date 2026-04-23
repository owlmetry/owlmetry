import type { JobRunner } from "../services/job-runner.js";
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

export function registerAllJobs(runner: JobRunner): void {
  runner.register("db_pruning", dbPruningHandler);
  runner.register("soft_delete_cleanup", softDeleteCleanupHandler);
  runner.register("partition_creation", partitionCreationHandler);
  runner.register("revenuecat_sync", revenuecatSyncHandler);
  runner.register("retention_cleanup", retentionCleanupHandler);
  runner.register("issue_scan", issueScanHandler);
  runner.register("issue_notify", issueNotifyHandler);
  runner.register("attachment_cleanup", attachmentCleanupHandler);
  runner.register("apple_ads_sync", appleAdsSyncHandler);
  runner.register("app_version_sync", appVersionSyncHandler);
}
