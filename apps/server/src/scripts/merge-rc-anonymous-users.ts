/**
 * One-off maintenance: merge phantom `$RCAnonymousID:*` app_users rows into
 * their canonical rows.
 *
 * A now-fixed webhook bug wrote subscription props (and, via the background
 * resync, revenue) under RevenueCat's anonymous customer ID instead of the
 * canonical app_user_id, creating phantom app_users rows. RC's V2
 * GET /v2/projects/{rcProjectId}/customers/{anonId} resolves aliases — it
 * returns the canonical customer whose `id` is the real app_user_id
 * (verified live) — so each phantom can be folded into its canonical row.
 *
 * Per phantom row:
 *   - canonical row exists  → merge properties + revenue, delete the phantom
 *   - canonical row missing → rename the phantom to the canonical id
 *   - gone from RC / RC error / never aliased → skip conservatively
 *
 * Phantoms created by the webhook/sync upsert have zero events and no
 * app_user_apps junction rows, so no event-table rewrites are needed. The
 * script ENFORCES that invariant rather than assuming it: any prefixed row
 * with junction rows (i.e. created via ordinary ingest — e.g. an app passing
 * RC's Purchases.appUserID into Owl.setUser while anonymous) is skipped
 * loudly, since deleting it would orphan its events and renaming it would
 * strand them under the old id. Idempotent: a re-run finds no remaining
 * `$RCAnonymousID:*` rows in RC-integrated projects, and every skip is
 * deterministic. RC 429s retry once after a 5s backoff (same as the
 * user-backfill job); a persistent rate-limit window leaves rows as errors
 * (exit 1, no writes for those rows) — just re-run later, and avoid
 * overlapping the daily revenuecat_sync job, which shares the API key's
 * 480 req/min Customer Information budget.
 *
 * Usage (ALWAYS dry-run first — prints planned actions, writes nothing):
 *   npx tsx apps/server/src/scripts/merge-rc-anonymous-users.ts --dry-run
 *   npx tsx apps/server/src/scripts/merge-rc-anonymous-users.ts
 *
 * Prod runbook (ORDER MATTERS — the fixed webhook code must be RUNNING before
 * the live run, or anonymous-id webhook events + their background resyncs
 * keep re-creating phantoms and silently undo the cleanup):
 *   ssh -i ~/.ssh/digitalocean root@100.99.182.98
 *   cd /opt/owlmetry && git pull && pnpm install && NODE_OPTIONS='--max-old-space-size=1024' pnpm build && pm2 restart all
 *   # ^ the same git pull is what puts this script on the box, but the pm2
 *   #   restart is the easy-to-miss part that swaps in the webhook fix —
 *   #   without it the old process keeps writing new phantoms
 *   export $(grep ^DATABASE_URL /opt/owlmetry/.env | head -1)
 *   tsx apps/server/src/scripts/merge-rc-anonymous-users.ts --dry-run   # review the plan
 *   tsx apps/server/src/scripts/merge-rc-anonymous-users.ts             # apply
 */
import { and, eq, isNull, like } from "drizzle-orm";
import { createDatabaseConnection, appUsers, appUserApps, projectIntegrations } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { PG_UNIQUE_VIOLATION } from "@owlmetry/shared";
import { config } from "../config.js";
import {
  type RevenueCatConfig,
  RC_ANONYMOUS_PREFIX,
  fetchRevenueCatCustomer,
  fetchRevenueCatProjectId,
} from "../utils/revenuecat.js";
import { selectUnsetProps } from "../utils/user-properties.js";

// Reject anything that isn't exactly --dry-run: a typo'd flag (--dryrun,
// --dry_run, -dry-run) must NOT fall through to a live prod-mutating run.
const cliArgs = process.argv.slice(2);
const unknownArgs = cliArgs.filter((arg) => arg !== "--dry-run");
if (unknownArgs.length > 0) {
  console.error(`Unrecognized argument(s): ${unknownArgs.join(" ")} — only --dry-run is supported.`);
  process.exit(1);
}
const dryRun = cliArgs.includes("--dry-run");

// Same pacing as the RC user-backfill job (PER_USER_DELAY_MS = 400 in
// jobs/revenuecat-user-backfill.ts; the daily sync paces at 350ms) —
// ~2.5 req/s keeps us far under RC's 480 req/min Customer Information
// budget. 429s retry once after RATE_LIMIT_BACKOFF_MS, mirroring the
// backfill job, since that budget is shared with the daily sync + webhook
// resyncs on the same key.
const RC_CALL_INTERVAL_MS = 400;
const RATE_LIMIT_BACKOFF_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PhantomRow {
  id: string;
  project_id: string;
  user_id: string;
  properties: Record<string, string> | null;
  total_revenue_usd_cents: number | null;
  revenue_synced_at: Date | null;
}

interface CanonicalRow {
  id: string;
  properties: Record<string, string> | null;
  total_revenue_usd_cents: number | null;
  revenue_synced_at: Date | null;
}

interface Counters {
  merged: number;
  renamed: number;
  skipped_not_found: number;
  skipped_never_aliased: number;
  skipped_no_integration: number;
  skipped_has_activity: number;
  errors: number;
}

const newCounters = (): Counters => ({
  merged: 0,
  renamed: 0,
  skipped_not_found: 0,
  skipped_never_aliased: 0,
  skipped_no_integration: 0,
  skipped_has_activity: 0,
  errors: 0,
});

interface MergePlan {
  properties: Record<string, string>;
  rcOverwriteKeys: string[];
  fillKeys: string[];
  copyRevenue: boolean;
}

/**
 * Properties: start from canonical; phantom `rc_*` keys overwrite (canonical
 * almost certainly has none — the phantom's came from the latest webhook);
 * phantom non-rc_* keys (attribution etc.) only fill slots unset on canonical
 * (selectUnsetProps semantics, same as the RC attribution backfill).
 *
 * Revenue: copy the phantom's lifetime total ONLY when canonical has none, or
 * canonical's revenue_synced_at is older than the phantom's. NEVER sum — both
 * columns are lifetime totals for the same RC customer.
 */
function buildMergePlan(phantom: PhantomRow, canonical: CanonicalRow): MergePlan {
  const phantomProps = phantom.properties ?? {};
  const canonicalProps = canonical.properties ?? {};
  const rcEntries = Object.entries(phantomProps).filter(([key]) => key.startsWith("rc_"));
  const nonRcProps = Object.fromEntries(
    Object.entries(phantomProps).filter(([key]) => !key.startsWith("rc_")),
  );
  const fillProps = selectUnsetProps(nonRcProps, canonicalProps);
  const copyRevenue =
    phantom.total_revenue_usd_cents !== null &&
    (canonical.total_revenue_usd_cents === null ||
      (canonical.revenue_synced_at !== null &&
        phantom.revenue_synced_at !== null &&
        canonical.revenue_synced_at.getTime() < phantom.revenue_synced_at.getTime()));
  return {
    properties: { ...canonicalProps, ...fillProps, ...Object.fromEntries(rcEntries) },
    rcOverwriteKeys: rcEntries.map(([key]) => key),
    fillKeys: Object.keys(fillProps),
    copyRevenue,
  };
}

function describeMergePlan(plan: MergePlan, phantom: PhantomRow): string {
  const parts = [
    `rc_* overwrite: ${plan.rcOverwriteKeys.length > 0 ? plan.rcOverwriteKeys.join(", ") : "(none)"}`,
    `fill unset: ${plan.fillKeys.length > 0 ? plan.fillKeys.join(", ") : "(none)"}`,
    plan.copyRevenue
      ? `revenue: copy ${phantom.total_revenue_usd_cents}¢ synced_at=${phantom.revenue_synced_at?.toISOString()}`
      : "revenue: keep canonical",
  ];
  return parts.join("; ");
}

function isUniqueViolation(err: unknown): boolean {
  // postgres-js throws PostgresError with `code`; depending on the drizzle
  // call path it may arrive wrapped, so walk the `cause` chain too.
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === PG_UNIQUE_VIOLATION) return true;
  }
  return false;
}

type AbsorbResult =
  | { action: "merged"; plan: MergePlan }
  | { action: "renamed" }
  | { action: "already_done" };

/**
 * Fold one phantom into its canonical id inside a single transaction:
 * merge + delete when the canonical row exists, rename otherwise. Both rows
 * are re-selected WITH `FOR UPDATE` row locks inside the transaction — a
 * plain re-select under READ COMMITTED would not stop a concurrent writer
 * (live webhook traffic via mergeUserProperties' atomic JSONB `||` upsert)
 * from committing between our SELECT and the whole-object properties UPDATE,
 * which would silently clobber its write. With the locks, the concurrent
 * upsert blocks until we commit and then applies its merge on top.
 *
 * The phantom's prefix is re-verified under the lock: a concurrent script
 * instance may have already RENAMED this row to the canonical id, in which
 * case the canonical select below would return this very row and the merge
 * branch would "merge" it into itself and DELETE it — destroying the only
 * copy of the user's props/revenue/first_seen. The guard turns that into a
 * no-op (the row, under either id, is by then the canonical row).
 *
 * A rename can still lose a race with a canonical row created between our
 * select and the UPDATE — that surfaces as a 23505 unique violation
 * (app_users_project_user_idx); the caller retries once, which then takes
 * the merge branch.
 */
async function absorbPhantom(db: Db, phantomId: string, canonicalUserId: string): Promise<AbsorbResult> {
  return db.transaction(async (tx): Promise<AbsorbResult> => {
    const [phantom] = await tx
      .select({
        id: appUsers.id,
        project_id: appUsers.project_id,
        user_id: appUsers.user_id,
        properties: appUsers.properties,
        total_revenue_usd_cents: appUsers.total_revenue_usd_cents,
        revenue_synced_at: appUsers.revenue_synced_at,
      })
      .from(appUsers)
      .where(eq(appUsers.id, phantomId))
      .limit(1)
      .for("update");
    if (!phantom) return { action: "already_done" }; // raced with another run — idempotent
    // Already renamed by a concurrent run — see the self-merge note above.
    if (!phantom.user_id.startsWith(RC_ANONYMOUS_PREFIX)) return { action: "already_done" };

    const [canonical] = await tx
      .select({
        id: appUsers.id,
        properties: appUsers.properties,
        total_revenue_usd_cents: appUsers.total_revenue_usd_cents,
        revenue_synced_at: appUsers.revenue_synced_at,
      })
      .from(appUsers)
      .where(and(eq(appUsers.project_id, phantom.project_id), eq(appUsers.user_id, canonicalUserId)))
      .limit(1)
      .for("update");

    if (canonical) {
      const plan = buildMergePlan(phantom, canonical);
      const updates: Partial<typeof appUsers.$inferInsert> = { properties: plan.properties };
      if (plan.copyRevenue) {
        updates.total_revenue_usd_cents = phantom.total_revenue_usd_cents;
        updates.revenue_synced_at = phantom.revenue_synced_at;
      }
      await tx.update(appUsers).set(updates).where(eq(appUsers.id, canonical.id));
      // Phantoms have zero events and no junction rows (created only by the
      // webhook/sync upsert), so deleting the row is the whole cleanup.
      await tx.delete(appUsers).where(eq(appUsers.id, phantom.id));
      return { action: "merged", plan };
    }

    // No canonical row yet — the rename preserves first/last_seen + revenue
    // as-is. is_anonymous was already false (mergeUserProperties only flags
    // the owl_anon_ prefix), set explicitly for clarity.
    await tx
      .update(appUsers)
      .set({ user_id: canonicalUserId, is_anonymous: false })
      .where(eq(appUsers.id, phantom.id));
    return { action: "renamed" };
  });
}

// 429 = the shared per-key budget is momentarily exhausted (daily sync /
// webhook resyncs on the same key), not a permanent failure — back off once
// and retry, mirroring revenuecat-user-backfill.ts. Still-429 after the
// retry falls through to the caller's error handling (row skipped, exit 1).
async function fetchCustomerWithRateLimitRetry(
  apiKey: string,
  rcProjectId: string,
  userId: string,
): Promise<Awaited<ReturnType<typeof fetchRevenueCatCustomer>>> {
  const result = await fetchRevenueCatCustomer(apiKey, rcProjectId, userId);
  if (result.status !== "error" || result.statusCode !== 429) return result;
  console.log(`  ↻ ${userId} — RC 429, backing off ${RATE_LIMIT_BACKOFF_MS}ms and retrying once`);
  await sleep(RATE_LIMIT_BACKOFF_MS);
  return fetchRevenueCatCustomer(apiKey, rcProjectId, userId);
}

const db = createDatabaseConnection(config.databaseUrl);

console.log(`merge-rc-anonymous-users ${dryRun ? "(DRY RUN — no writes)" : "(LIVE)"}`);

// LEFT JOIN so phantoms in projects without an active RC integration still
// surface in the report (we can't resolve those without an API key).
// `$` is not a LIKE metacharacter, so the prefix needs no escaping.
const phantomRows = await db
  .select({
    id: appUsers.id,
    project_id: appUsers.project_id,
    user_id: appUsers.user_id,
    properties: appUsers.properties,
    total_revenue_usd_cents: appUsers.total_revenue_usd_cents,
    revenue_synced_at: appUsers.revenue_synced_at,
    integration_config: projectIntegrations.config,
  })
  .from(appUsers)
  .leftJoin(
    projectIntegrations,
    and(
      eq(projectIntegrations.project_id, appUsers.project_id),
      eq(projectIntegrations.provider, "revenuecat"),
      eq(projectIntegrations.enabled, true),
      isNull(projectIntegrations.deleted_at),
    ),
  )
  .where(like(appUsers.user_id, `${RC_ANONYMOUS_PREFIX}%`))
  .orderBy(appUsers.project_id, appUsers.user_id);

console.log(`Found ${phantomRows.length} phantom app_users row(s) with the ${RC_ANONYMOUS_PREFIX} prefix.`);

// Group by project. The (project_id, provider) unique index guarantees at
// most one RC integration row per project, so the join never fans out and
// every row in a group carries the same integration_config.
const byProject = new Map<string, typeof phantomRows>();
for (const row of phantomRows) {
  const group = byProject.get(row.project_id);
  if (group) group.push(row);
  else byProject.set(row.project_id, [row]);
}

const perProject = new Map<string, Counters>();
const totals = newCounters();
let projectsFailed = 0;

const bump = (projectId: string, key: keyof Counters, by = 1) => {
  let counters = perProject.get(projectId);
  if (!counters) {
    counters = newCounters();
    perProject.set(projectId, counters);
  }
  counters[key] += by;
  totals[key] += by;
};

for (const [projectId, rows] of [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`\n=== project ${projectId}: ${rows.length} phantom row(s) ===`);

  // No active RC integration → log-only, skipped (no API key to resolve with).
  if (rows[0].integration_config === null) {
    for (const row of rows) {
      console.log(`  ⏭️  ${row.user_id} — no active RevenueCat integration, cannot resolve (skipped)`);
    }
    bump(projectId, "skipped_no_integration", rows.length);
    continue;
  }

  // Parse the integration config + resolve the RC project id; either failing
  // skips the whole project (isolated — other projects still process). The
  // rows count as errors so the exit code flags the run as incomplete.
  const rcConfig = rows[0].integration_config as unknown as RevenueCatConfig;
  if (typeof rcConfig.api_key !== "string" || rcConfig.api_key.length === 0) {
    console.error(`  ✗ integration config has no api_key — skipping project (${rows.length} row(s) counted as errors)`);
    bump(projectId, "errors", rows.length);
    projectsFailed++;
    continue;
  }

  const projectIdResult = await fetchRevenueCatProjectId(rcConfig.api_key);
  await sleep(RC_CALL_INTERVAL_MS);
  if (projectIdResult.status !== "found") {
    const detail =
      projectIdResult.status === "error"
        ? `HTTP ${projectIdResult.statusCode ?? "?"}: ${projectIdResult.message ?? "(no body)"}`
        : "key has no accessible RC projects";
    console.error(`  ✗ could not resolve RC project id (${detail}) — skipping project (${rows.length} row(s) counted as errors)`);
    bump(projectId, "errors", rows.length);
    projectsFailed++;
    continue;
  }
  const rcProjectId = projectIdResult.projectId;
  console.log(`  RC project: ${rcProjectId}`);

  // Dry-run cross-row state: when two phantoms in one project resolve to the
  // same canonical id, the one-shot plan below diverges from live behavior
  // (live re-selects in-tx, so the first rename/merge changes what the second
  // sees) — track targets so the printed plan annotates the divergence.
  const dryRunCanonicalTargets = new Set<string>();

  for (const phantom of rows) {
    try {
      // Enforce (don't just assume) the zero-activity invariant from the
      // header: webhook/sync upserts only ever write the app_users row, but
      // an ingest-created row could carry this prefix too (an app passing
      // RC's Purchases.appUserID into Owl.setUser while anonymous). Such a
      // row has events + junction rows — deleting it would orphan its events
      // and renaming it would strand them under the old id. Every
      // events-bearing user has an app_user_apps row, so one cheap
      // non-partitioned lookup is the guard.
      const [activity] = await db
        .select({ id: appUserApps.id })
        .from(appUserApps)
        .where(eq(appUserApps.app_user_id, phantom.id))
        .limit(1);
      if (activity) {
        console.log(
          `  ⏭️  ${phantom.user_id} — has app_user_apps junction rows (ingest-created, not a webhook phantom; skipped, handle manually)`,
        );
        bump(projectId, "skipped_has_activity");
        continue;
      }

      const customerResult = await fetchCustomerWithRateLimitRetry(rcConfig.api_key, rcProjectId, phantom.user_id);
      await sleep(RC_CALL_INTERVAL_MS);

      if (customerResult.status === "not_found") {
        console.log(`  ⏭️  ${phantom.user_id} — gone from RC (skipped, row left in place)`);
        bump(projectId, "skipped_not_found");
        continue;
      }
      if (customerResult.status === "error") {
        console.error(
          `  ✗ ${phantom.user_id} — RC error HTTP ${customerResult.statusCode ?? "?"}: ${customerResult.message ?? "(no body)"} (skipped)`,
        );
        bump(projectId, "errors");
        continue;
      }
      const canonicalUserId = customerResult.customer.id;
      if (canonicalUserId.startsWith(RC_ANONYMOUS_PREFIX)) {
        console.log(`  ⏭️  ${phantom.user_id} — never aliased to a real user id (skipped)`);
        bump(projectId, "skipped_never_aliased");
        continue;
      }

      const [canonical] = await db
        .select({
          id: appUsers.id,
          properties: appUsers.properties,
          total_revenue_usd_cents: appUsers.total_revenue_usd_cents,
          revenue_synced_at: appUsers.revenue_synced_at,
        })
        .from(appUsers)
        .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, canonicalUserId)))
        .limit(1);

      if (dryRun) {
        // Plan + print only — no transaction is ever opened under --dry-run.
        const duplicateTarget = dryRunCanonicalTargets.has(canonicalUserId);
        dryRunCanonicalTargets.add(canonicalUserId);
        if (canonical) {
          const plan = buildMergePlan(phantom, canonical);
          console.log(
            `  [dry-run] MERGE ${phantom.user_id} → ${canonicalUserId} (${describeMergePlan(plan, phantom)})` +
              (duplicateTarget
                ? " [note: an earlier phantom in this run targets the same canonical id — live recomputes after that action, so fill/revenue details may differ]"
                : ""),
          );
          bump(projectId, "merged");
        } else if (duplicateTarget) {
          // No canonical row yet, but an earlier phantom in this run renames
          // to this id — live would find that row in-tx and MERGE, not rename.
          console.log(
            `  [dry-run] MERGE ${phantom.user_id} → ${canonicalUserId} [an earlier phantom in this run renames to this id — live merges into that row; details computed at run time]`,
          );
          bump(projectId, "merged");
        } else {
          console.log(`  [dry-run] RENAME ${phantom.user_id} → ${canonicalUserId} (no canonical row yet)`);
          bump(projectId, "renamed");
        }
        continue;
      }

      let result: AbsorbResult;
      try {
        result = await absorbPhantom(db, phantom.id, canonicalUserId);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Canonical row created between our select and the rename UPDATE
        // (live webhook/ingest traffic) — retry once; it now merges.
        console.log(`  ↻ ${phantom.user_id} — rename hit unique violation, retrying as merge`);
        result = await absorbPhantom(db, phantom.id, canonicalUserId);
      }

      if (result.action === "merged") {
        console.log(`  ✓ MERGED ${phantom.user_id} → ${canonicalUserId} (${describeMergePlan(result.plan, phantom)})`);
        bump(projectId, "merged");
      } else if (result.action === "renamed") {
        console.log(`  ✓ RENAMED ${phantom.user_id} → ${canonicalUserId}`);
        bump(projectId, "renamed");
      } else {
        console.log(`  ✓ ${phantom.user_id} — already gone (nothing to do)`);
      }
    } catch (err) {
      console.error(`  ✗ ${phantom.user_id} — unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      bump(projectId, "errors");
    }
  }
}

const formatCounters = (c: Counters): string =>
  `merged=${c.merged} renamed=${c.renamed} ` +
  `skipped_not_found=${c.skipped_not_found} skipped_never_aliased=${c.skipped_never_aliased} ` +
  `skipped_no_integration=${c.skipped_no_integration} skipped_has_activity=${c.skipped_has_activity} ` +
  `errors=${c.errors}`;

console.log("\n=== Summary ===");
for (const [projectId, counters] of [...perProject.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  project ${projectId}: ${formatCounters(counters)}`);
}
console.log(
  `  TOTAL: ${formatCounters(totals)}` +
    (projectsFailed > 0 ? ` (${projectsFailed} project(s) skipped entirely)` : ""),
);
if (dryRun) console.log("  Dry run — nothing was written.");

await db.$client.end();
process.exit(totals.errors > 0 ? 1 : 0);
