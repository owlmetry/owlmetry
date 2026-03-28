import {
  ensurePartitions,
  ensureMetricEventPartitions,
  ensureFunnelEventPartitions,
} from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";

export const partitionCreationHandler: JobHandler = async (ctx) => {
  const client = ctx.createClient();
  try {
    await ensurePartitions(client, 3);
    await ensureMetricEventPartitions(client, 3);
    await ensureFunnelEventPartitions(client, 3);

    return { events: true, metric_events: true, funnel_events: true, _silent: true };
  } finally {
    await client.end();
  }
};
