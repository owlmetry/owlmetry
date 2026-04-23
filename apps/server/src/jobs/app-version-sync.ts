import { eq, isNull, and } from "drizzle-orm";
import { apps } from "@owlmetry/db";
import { compareVersions } from "@owlmetry/shared";
import type postgres from "postgres";
import type { JobHandler } from "../services/job-runner.js";

const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const ITUNES_TIMEOUT_MS = 10_000;
const ITUNES_INTER_REQUEST_DELAY_MS = 100;

interface ItunesLookupResponse {
  resultCount: number;
  results: Array<{ version?: string; bundleId?: string }>;
}

type LookupResult =
  | { kind: "found"; version: string }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

async function lookupAppleAppVersion(bundleId: string): Promise<LookupResult> {
  try {
    const url = `${ITUNES_LOOKUP_URL}?bundleId=${encodeURIComponent(bundleId)}&country=us`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { kind: "error", message: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as ItunesLookupResponse;
    const version = data.results?.[0]?.version;
    if (!version) return { kind: "not_found" };
    return { kind: "found", version };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

async function computeLatestFromEvents(
  client: postgres.Sql,
  appId: string,
): Promise<string | null> {
  const rows = await client<{ app_version: string }[]>`
    SELECT DISTINCT app_version FROM events
    WHERE app_id = ${appId} AND is_dev = false AND app_version IS NOT NULL
    LIMIT 200
  `;
  if (rows.length === 0) return null;
  let max = rows[0].app_version;
  for (let i = 1; i < rows.length; i++) {
    if (compareVersions(rows[i].app_version, max) > 0) {
      max = rows[i].app_version;
    }
  }
  return max;
}

export const appVersionSyncHandler: JobHandler = async (ctx, params) => {
  const targetAppId = typeof params.app_id === "string" ? params.app_id : null;

  const baseQuery = ctx.db
    .select({
      id: apps.id,
      platform: apps.platform,
      bundle_id: apps.bundle_id,
    })
    .from(apps);

  const allApps = targetAppId
    ? await baseQuery.where(and(eq(apps.id, targetAppId), isNull(apps.deleted_at)))
    : await baseQuery.where(isNull(apps.deleted_at));

  let processed = 0;
  let appStoreSynced = 0;
  let computedSynced = 0;
  let nullified = 0;
  let errors = 0;

  const client = ctx.createClient();
  try {
    for (let i = 0; i < allApps.length; i++) {
      if (ctx.isCancelled()) break;
      const app = allApps[i];

      let version: string | null = null;
      let source: "app_store" | "computed" | null = null;

      if (app.platform === "apple" && app.bundle_id) {
        if (i > 0) await new Promise((r) => setTimeout(r, ITUNES_INTER_REQUEST_DELAY_MS));
        const result = await lookupAppleAppVersion(app.bundle_id);
        if (result.kind === "found") {
          version = result.version;
          source = "app_store";
          appStoreSynced++;
        } else if (result.kind === "error") {
          ctx.log.warn(
            { app_id: app.id, bundle_id: app.bundle_id, message: result.message },
            "iTunes lookup failed, falling back to computed",
          );
          errors++;
        }
      }

      if (version === null) {
        const computed = await computeLatestFromEvents(client, app.id);
        if (computed) {
          version = computed;
          source = "computed";
          computedSynced++;
        } else {
          nullified++;
        }
      }

      await ctx.db
        .update(apps)
        .set({
          latest_app_version: version,
          latest_app_version_source: source,
          latest_app_version_updated_at: new Date(),
        })
        .where(eq(apps.id, app.id));

      processed++;
      if (processed % 10 === 0) {
        await ctx.updateProgress({
          processed,
          total: allApps.length,
          message: `Processed ${processed}/${allApps.length} apps`,
        });
      }
    }
  } finally {
    await client.end();
  }

  const synced = appStoreSynced + computedSynced;
  return {
    apps_processed: processed,
    app_store_synced: appStoreSynced,
    computed_synced: computedSynced,
    no_version_available: nullified,
    errors,
    _silent: synced === 0 && errors === 0,
  };
};
