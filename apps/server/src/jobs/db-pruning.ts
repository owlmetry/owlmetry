import { dropOldestEventPartitions } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";

export const dbPruningHandler: JobHandler = async (ctx, params) => {
  const maxSizeBytes = params.max_size_bytes as number;
  if (!maxSizeBytes || maxSizeBytes <= 0) {
    return { skipped: true, reason: "max_size_bytes not configured" };
  }

  const client = ctx.createClient();
  try {
    const result = await dropOldestEventPartitions(client, maxSizeBytes);

    if (result.droppedPartitions.length > 0 || result.deletedRows > 0) {
      ctx.log.info(
        `Database pruning: dropped partitions [${result.droppedPartitions.join(", ")}], ` +
          `deleted ${result.deletedRows} rows. ` +
          `Current size: ${(result.currentSizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
      );
    }

    return {
      dropped_partitions: result.droppedPartitions,
      deleted_rows: result.deletedRows,
      current_size_gb: Number((result.currentSizeBytes / 1024 / 1024 / 1024).toFixed(2)),
    };
  } finally {
    await client.end();
  }
};
