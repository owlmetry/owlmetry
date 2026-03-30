import type { JobRunner } from "../services/job-runner.js";
import { dbPruningHandler } from "./db-pruning.js";
import { softDeleteCleanupHandler } from "./soft-delete-cleanup.js";
import { partitionCreationHandler } from "./partition-creation.js";
import { revenuecatSyncHandler } from "./revenuecat-sync.js";
import { retentionCleanupHandler } from "./retention-cleanup.js";

export function registerAllJobs(runner: JobRunner): void {
  runner.register("db_pruning", dbPruningHandler);
  runner.register("soft_delete_cleanup", softDeleteCleanupHandler);
  runner.register("partition_creation", partitionCreationHandler);
  runner.register("revenuecat_sync", revenuecatSyncHandler);
  runner.register("retention_cleanup", retentionCleanupHandler);
}
