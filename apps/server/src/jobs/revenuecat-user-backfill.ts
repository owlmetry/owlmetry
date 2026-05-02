import { eq, and } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import type { JobHandler } from "../services/job-runner.js";
import {
  type RevenueCatConfig,
  RC_ANONYMOUS_PREFIX,
  fetchRevenueCatCustomers,
  fetchRevenueCatProjectId,
} from "../utils/revenuecat.js";
import { syncRevenueCatUserProperties } from "../utils/revenuecat-user-sync.js";
import { findActiveIntegration } from "../utils/integrations.js";

const PER_USER_DELAY_MS = 400;
const RATE_LIMIT_BACKOFF_MS = 5000;
const MAX_USER_IDS = 10;
const PAGE_SIZE_FALLBACKS = [100, 50, 20] as const;

type BackfillResult = {
  total_listed: number;
  skipped_anonymous: number;
  created: number;
  updated: number;
  not_found: number;
  errors: number;
  pages_fetched: number;
  page_size: number;
  error_status_counts?: Record<string, number>;
  not_found_users?: string[];
  error_users?: string[];
  aborted?: boolean;
  abort_reason?: string;
  last_starting_after?: string | null;
  cancelled_at?: number;
} & Record<string, unknown>;

export const revenuecatUserBackfillHandler: JobHandler = async (ctx, params) => {
  const projectId = typeof params.project_id === "string" ? params.project_id : null;
  if (!projectId) {
    throw new Error("revenuecat_user_backfill requires a project_id param");
  }

  const integration = await findActiveIntegration(ctx.db, projectId, "revenuecat");
  if (!integration) {
    throw new Error("RevenueCat integration not found or disabled");
  }

  const rcConfig = integration.config as unknown as RevenueCatConfig;

  const projectIdResult = await fetchRevenueCatProjectId(rcConfig.api_key);
  if (projectIdResult.status !== "found") {
    const statusCode = projectIdResult.status === "error" ? projectIdResult.statusCode : undefined;
    const message = projectIdResult.status === "error" ? projectIdResult.message : undefined;
    const reason = projectIdResult.status === "no_projects"
      ? "RevenueCat API key has no accessible projects. Generate a project-scoped V2 secret key in RevenueCat → Project Settings → API Keys."
      : `RevenueCat API error while resolving project: HTTP ${statusCode ?? "network"} — ${message ?? "no response body"}`;
    ctx.log.error(
      { projectId, statusCode, message },
      "RC user backfill aborting — could not resolve RevenueCat project",
    );
    return {
      total_listed: 0,
      skipped_anonymous: 0,
      created: 0,
      updated: 0,
      not_found: 0,
      errors: 0,
      pages_fetched: 0,
      page_size: 0,
      aborted: true,
      abort_reason: reason,
    } satisfies BackfillResult;
  }
  const rcProjectId = projectIdResult.projectId;

  let totalListed = 0;
  let skippedAnonymous = 0;
  let created = 0;
  let updated = 0;
  let notFound = 0;
  let errors = 0;
  let pagesFetched = 0;
  const notFoundUsers: string[] = [];
  const errorUsers: string[] = [];
  const errorStatusCounts: Record<string, number> = {};

  function recordErrorStatus(statusCode: number | undefined) {
    const key = statusCode !== undefined ? String(statusCode) : "network";
    errorStatusCounts[key] = (errorStatusCounts[key] ?? 0) + 1;
  }

  function buildResult(extra?: Partial<BackfillResult>): BackfillResult {
    const result: BackfillResult = {
      total_listed: totalListed,
      skipped_anonymous: skippedAnonymous,
      created,
      updated,
      not_found: notFound,
      errors,
      pages_fetched: pagesFetched,
      page_size: pageSize,
      ...extra,
    };
    if (notFoundUsers.length > 0) {
      result.not_found_users = notFound > MAX_USER_IDS
        ? [...notFoundUsers, `...and ${notFound - MAX_USER_IDS} more`]
        : notFoundUsers;
    }
    if (errorUsers.length > 0) {
      result.error_users = errors > MAX_USER_IDS
        ? [...errorUsers, `...and ${errors - MAX_USER_IDS} more`]
        : errorUsers;
    }
    if (Object.keys(errorStatusCounts).length > 0) {
      result.error_status_counts = errorStatusCounts;
    }
    return result;
  }

  // RC docs don't publish a max page size. Probe 100 → 50 → 20 on the first
  // page only; once a size works, hold it for the rest of the run.
  let pageSize: number = PAGE_SIZE_FALLBACKS[0];
  let pageSizeIndex = 0;
  let startingAfter: string | null = null;
  let lastStartingAfter: string | null = null;

  await ctx.updateProgress({
    processed: 0,
    total: 0,
    message: "Starting RevenueCat customer backfill...",
  });

  while (true) {
    if (ctx.isCancelled()) {
      ctx.log.info(`RC user backfill cancelled after ${totalListed} listed (project ${projectId})`);
      return buildResult({ cancelled_at: totalListed, last_starting_after: startingAfter });
    }

    let listResult = await fetchRevenueCatCustomers(rcConfig.api_key, rcProjectId, {
      startingAfter,
      limit: pageSize,
    });

    // Page-size probe: if the very first request fails on 4xx (other than auth),
    // try smaller pages before giving up. This only runs on page 1.
    if (
      listResult.status === "error"
      && pagesFetched === 0
      && listResult.statusCode !== undefined
      && listResult.statusCode >= 400
      && listResult.statusCode < 500
      && listResult.statusCode !== 401
      && listResult.statusCode !== 403
      && listResult.statusCode !== 429
    ) {
      while (pageSizeIndex < PAGE_SIZE_FALLBACKS.length - 1 && listResult.status === "error") {
        pageSizeIndex++;
        pageSize = PAGE_SIZE_FALLBACKS[pageSizeIndex];
        ctx.log.warn(
          { projectId, statusCode: listResult.statusCode, message: listResult.message, pageSize },
          "RC list-customers failed on first page — retrying with smaller page size",
        );
        listResult = await fetchRevenueCatCustomers(rcConfig.api_key, rcProjectId, {
          startingAfter,
          limit: pageSize,
        });
      }
    }

    // 429 retry once after a short pause (covers list calls).
    if (listResult.status === "error" && listResult.statusCode === 429) {
      ctx.log.warn(
        { projectId, statusCode: 429 },
        "RC list-customers rate-limited — backing off and retrying once",
      );
      await sleep(RATE_LIMIT_BACKOFF_MS);
      listResult = await fetchRevenueCatCustomers(rcConfig.api_key, rcProjectId, {
        startingAfter,
        limit: pageSize,
      });
    }

    if (listResult.status === "error") {
      const statusCode = listResult.statusCode;
      const message = listResult.message;

      // Auth failures are systemic — abort fast rather than retry every page.
      if (statusCode === 401 || statusCode === 403) {
        ctx.log.error(
          { projectId, statusCode, message },
          "RC user backfill aborting — RevenueCat rejected the API key",
        );
        return buildResult({
          aborted: true,
          abort_reason: `RevenueCat API rejected the key with HTTP ${statusCode}. Response: ${message ?? "(no body)"}`,
          last_starting_after: startingAfter,
        });
      }

      ctx.log.error(
        { projectId, statusCode, message, startingAfter },
        "RC user backfill aborting — list call failed",
      );
      return buildResult({
        aborted: true,
        abort_reason: `RevenueCat list-customers failed with HTTP ${statusCode ?? "network"}: ${message ?? "(no body)"}`,
        last_starting_after: startingAfter,
      });
    }

    pagesFetched++;
    totalListed += listResult.items.length;

    for (const customer of listResult.items) {
      if (ctx.isCancelled()) {
        ctx.log.info(`RC user backfill cancelled mid-page (project ${projectId})`);
        return buildResult({ cancelled_at: totalListed, last_starting_after: startingAfter });
      }

      if (customer.id.startsWith(RC_ANONYMOUS_PREFIX)) {
        skippedAnonymous++;
        continue;
      }

      // Determine created vs updated by checking for an existing row before
      // the upsert. We pull `properties` in the same select so the per-user
      // sync's attribution merge can use it without a second roundtrip.
      const [existing] = await ctx.db
        .select({ properties: appUsers.properties })
        .from(appUsers)
        .where(
          and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, customer.id)),
        )
        .limit(1);
      const existedBefore = existing !== undefined;

      try {
        let result = await syncRevenueCatUserProperties({
          db: ctx.db,
          log: ctx.log,
          projectId,
          rcProjectId,
          config: rcConfig,
          userId: customer.id,
          currentProps: (existing?.properties ?? {}) as Record<string, unknown>,
        });

        if (result.status === "error" && result.statusCode === 429) {
          ctx.log.warn(
            { projectId, userId: customer.id },
            "RC per-user sync rate-limited — backing off and retrying once",
          );
          await sleep(RATE_LIMIT_BACKOFF_MS);
          result = await syncRevenueCatUserProperties({
            db: ctx.db,
            log: ctx.log,
            projectId,
            rcProjectId,
            config: rcConfig,
            userId: customer.id,
            currentProps: (existing?.properties ?? {}) as Record<string, unknown>,
          });
        }

        if (result.status === "synced") {
          if (existedBefore) updated++;
          else created++;
        } else if (result.status === "not_found") {
          // Customer appeared in the list response but the per-user lookup
          // returned 404. Race window between list and lookup; uncommon but
          // possible. Bucket separately so it's visible without being an error.
          notFound++;
          if (notFoundUsers.length < MAX_USER_IDS) notFoundUsers.push(customer.id);
        } else {
          errors++;
          if (errorUsers.length < MAX_USER_IDS) errorUsers.push(customer.id);
          recordErrorStatus(result.statusCode);
          ctx.log.warn(
            { projectId, userId: customer.id, statusCode: result.statusCode, message: result.message },
            "RC user backfill error for user",
          );
          if (result.statusCode === 401 || result.statusCode === 403) {
            ctx.log.error(
              { projectId, statusCode: result.statusCode, message: result.message },
              "RC user backfill aborting — RevenueCat rejected the API key",
            );
            return buildResult({
              aborted: true,
              abort_reason: `RevenueCat API rejected the key with HTTP ${result.statusCode}. Response: ${result.message ?? "(no body)"}`,
              last_starting_after: startingAfter,
            });
          }
        }
      } catch (err) {
        ctx.log.warn({ err, projectId, userId: customer.id }, "RC user backfill failed for user");
        errors++;
        if (errorUsers.length < MAX_USER_IDS) errorUsers.push(customer.id);
        recordErrorStatus(undefined);
      }

      await sleep(PER_USER_DELAY_MS);
    }

    await ctx.updateProgress({
      processed: totalListed,
      total: 0,
      message:
        `${pagesFetched} page(s) fetched, ${totalListed} customer(s) listed, `
        + `${created} created, ${updated} updated, ${skippedAnonymous} skipped (anon), `
        + `${notFound} not found, ${errors} errors`,
    });

    if (listResult.nextStartingAfter === null) {
      break;
    }

    if (
      listResult.nextStartingAfter !== null
      && listResult.nextStartingAfter === lastStartingAfter
    ) {
      // RC returned the same cursor twice in a row — guard against an infinite
      // loop. Treat as an abort with the current counters preserved.
      ctx.log.error(
        { projectId, cursor: listResult.nextStartingAfter },
        "RC user backfill aborting — RevenueCat returned a non-advancing cursor",
      );
      return buildResult({
        aborted: true,
        abort_reason: "RevenueCat returned a non-advancing cursor",
        last_starting_after: startingAfter,
      });
    }

    lastStartingAfter = startingAfter;
    startingAfter = listResult.nextStartingAfter;
  }

  ctx.log.info(
    `RC user backfill complete (project ${projectId}): listed ${totalListed} across ${pagesFetched} page(s); `
    + `${created} created, ${updated} updated, ${skippedAnonymous} skipped (anon), `
    + `${notFound} not found, ${errors} errors.`,
  );

  return buildResult();
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
