import { cleanupSoftDeletedResources } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";

export const softDeleteCleanupHandler: JobHandler = async (ctx) => {
  const client = ctx.createClient();
  try {
    const result = await cleanupSoftDeletedResources(client);
    const total = Object.values(result).reduce((a, b) => a + b, 0);

    if (total > 0) {
      ctx.log.info(`Soft-delete cleanup: ${JSON.stringify(result)}`);
    }

    return { ...result, _silent: total === 0 } as unknown as Record<string, unknown>;
  } finally {
    await client.end();
  }
};
