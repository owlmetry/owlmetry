import { eq, and } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { ATTRIBUTION_SOURCE_PROPERTY, ATTRIBUTION_SOURCE_VALUES } from "@owlmetry/shared";
import { mergeUserProperties, selectUnsetProps } from "./user-properties.js";
import { mapRevenueCatAttributesToAttributionProperties } from "./attribution/revenuecat.js";
import {
  type RevenueCatConfig,
  type RevenueCatLookupMaps,
  type FetchProjectIdResult,
  RC_ANONYMOUS_PREFIX,
  mapSubscriberToProperties,
  fetchRevenueCatSubscriber,
  fetchRevenueCatSubscriptions,
  fetchRevenueCatNonSubscriptions,
  fetchRevenueCatCustomerAttributes,
  fetchRevenueCatProjectId,
  fetchRevenueCatProjectEntitlements,
  fetchRevenueCatProjectProducts,
  sumLifetimeRevenueUsd,
  sumLifetimeRevenueUsdFromNonSubs,
} from "./revenuecat.js";

interface SyncLog {
  info?(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error?(obj: Record<string, unknown>, msg: string): void;
}

export type SyncRevenueCatUserResult =
  | {
      status: "synced";
      properties: Record<string, string>;
      isActive: boolean;
      attribution: {
        synced: boolean;
        enriched: boolean;
        markedOrganic: boolean;
        skippedNoAsa: boolean;
      };
      revenue: {
        // null = subs fetch failed, leave the column alone. number = authoritative value to write.
        usdCents: number | null;
      };
    }
  | { status: "not_found" }
  | { status: "error"; statusCode?: number; message?: string };

export async function syncRevenueCatUserProperties(args: {
  db: Db;
  log: SyncLog;
  projectId: string;
  rcProjectId: string;
  config: RevenueCatConfig;
  userId: string;
  currentProps?: Record<string, unknown>;
  lookups?: RevenueCatLookupMaps;
}): Promise<SyncRevenueCatUserResult> {
  const { db, log, projectId, rcProjectId, config, userId, lookups } = args;

  // Chokepoint guard: every RC sync path funnels through here, and RC's V2
  // endpoints resolve aliases — a `$RCAnonymousID:*` id would "succeed" and
  // upsert the canonical customer's props + revenue under a phantom
  // app_users row. Callers pre-filter/translate, so hitting this means a
  // forgotten guard upstream; surface as a loud error rather than sync.
  if (userId.startsWith(RC_ANONYMOUS_PREFIX)) {
    return {
      status: "error",
      message: "Refusing to sync a RevenueCat anonymous ID — its data belongs to the canonical (aliased) user",
    };
  }

  const subscriberResult = await fetchRevenueCatSubscriber(config.api_key, rcProjectId, userId);
  if (subscriberResult.status === "not_found") return { status: "not_found" };
  if (subscriberResult.status === "error") {
    return {
      status: "error",
      statusCode: subscriberResult.statusCode,
      message: subscriberResult.message,
    };
  }

  const [subsResult, nonSubsResult, attrsResult] = await Promise.all([
    fetchRevenueCatSubscriptions(config.api_key, rcProjectId, userId),
    fetchRevenueCatNonSubscriptions(config.api_key, rcProjectId, userId),
    fetchRevenueCatCustomerAttributes(config.api_key, rcProjectId, userId),
  ]);

  const subsData = subsResult.status === "found" ? subsResult.data : undefined;
  if (subsResult.status === "error") {
    log.warn(
      { userId, statusCode: subsResult.statusCode, message: subsResult.message },
      "RC subscriptions fetch failed (continuing with entitlements-only props)",
    );
  }

  const nonSubsData = nonSubsResult.status === "found" ? nonSubsResult.data : undefined;
  if (nonSubsResult.status === "error") {
    log.warn(
      { userId, statusCode: nonSubsResult.statusCode, message: nonSubsResult.message },
      "RC non-subscriptions fetch failed (continuing without one-time IAP revenue)",
    );
  } else if (nonSubsResult.status === "unavailable") {
    // Endpoint not enabled for this RC plan — log once at info, not warn.
    log.info?.(
      { userId, statusCode: nonSubsResult.statusCode },
      "RC non-subscriptions endpoint unavailable (skipping one-time IAP revenue)",
    );
  }

  const attribution = { synced: false, enriched: false, markedOrganic: false, skippedNoAsa: false };
  let attributionProps: Record<string, string> = {};

  if (attrsResult.status === "found") {
    const mapped = mapRevenueCatAttributesToAttributionProperties(attrsResult.attributes);
    if (Object.keys(mapped).length === 0) {
      attribution.skippedNoAsa = true;
    } else {
      let currentProps = args.currentProps;
      if (currentProps === undefined) {
        const [row] = await db
          .select({ properties: appUsers.properties })
          .from(appUsers)
          .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, userId)))
          .limit(1);
        currentProps = (row?.properties ?? {}) as Record<string, unknown>;
      }
      attributionProps = selectUnsetProps(mapped, currentProps);
      if (Object.keys(attributionProps).length > 0) {
        const isOrganic = mapped[ATTRIBUTION_SOURCE_PROPERTY] === ATTRIBUTION_SOURCE_VALUES.none;
        if (isOrganic) {
          attribution.markedOrganic = true;
        } else if (currentProps[ATTRIBUTION_SOURCE_PROPERTY] !== undefined) {
          attribution.enriched = true;
        } else {
          attribution.synced = true;
        }
      }
    }
  } else if (attrsResult.status === "error") {
    log.warn(
      { userId, statusCode: attrsResult.statusCode, message: attrsResult.message },
      "RC attributes fetch failed (continuing without attribution backfill)",
    );
  }

  // RC pre-computes per-line-item `total_revenue_in_usd` (refunds netted), so
  // summing is authoritative. Subs + non-subs cover both renewing and one-time
  // paid IAPs; if either fetch failed we contribute nothing from that source
  // (overwriting with 0 would silently zero out a paying user during a
  // transient RC outage). Both failing leaves the column untouched.
  const subRevenue = subsResult.status === "found" ? sumLifetimeRevenueUsd(subsData) : null;
  const nonSubRevenue = nonSubsResult.status === "found" ? sumLifetimeRevenueUsdFromNonSubs(nonSubsData) : null;
  const revenueUsd =
    subRevenue === null && nonSubRevenue === null ? null : (subRevenue ?? 0) + (nonSubRevenue ?? 0);
  const revenueUsdCents = revenueUsd === null ? null : Math.round(revenueUsd * 100);
  const subscriberProps = mapSubscriberToProperties(subscriberResult.data, subsData, nonSubsData, lookups);
  const properties = { ...subscriberProps, ...attributionProps };
  if (revenueUsd !== null) {
    properties.rc_total_revenue_usd = revenueUsd.toFixed(2);
  }
  await mergeUserProperties(
    db,
    projectId,
    userId,
    properties,
    revenueUsdCents !== null
      ? { total_revenue_usd_cents: revenueUsdCents, revenue_synced_at: new Date() }
      : undefined,
  );

  return {
    status: "synced",
    properties,
    isActive: subscriberProps.rc_status === "active",
    attribution,
    revenue: { usdCents: revenueUsdCents },
  };
}

interface BackgroundResyncLog {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

// Entitlement + product definitions change a few times a year, so caching
// the lookup maps in-process saves two RC round-trips per webhook resync and
// per manual single-user sync. 5-minute TTL bounds drift after a lookup_key
// rename. Mirrors the JWT cache pattern in apns/jwt.ts.
const LOOKUP_MAPS_CACHE_TTL_MS = 5 * 60 * 1000;
const lookupMapsCache = new Map<string, { maps: RevenueCatLookupMaps; expiresAt: number }>();

// Exported for tests — between tests, fetch-mock targets change but the
// cache key (`rcProjectId`) is constant, so without clearing the cache a
// later test would see an earlier test's lookup maps.
export function clearRevenueCatLookupMapsCache(): void {
  lookupMapsCache.clear();
}

/**
 * Fetch the project's entitlement + product definitions in parallel and build
 * the lookup maps used by `mapSubscriberToProperties`. List-fetch failures
 * degrade gracefully — the corresponding map is left empty, so the affected
 * `rc_entitlements` / `rc_product` values fall back to raw RC IDs rather than
 * aborting the entire sync.
 *
 * Cached per `rcProjectId` for 5 minutes. Failures are NOT cached so a
 * transient outage doesn't poison subsequent syncs for the full TTL.
 */
export async function fetchRevenueCatLookupMaps(args: {
  apiKey: string;
  rcProjectId: string;
  log: SyncLog;
}): Promise<RevenueCatLookupMaps> {
  const { apiKey, rcProjectId, log } = args;
  const now = Date.now();
  const cached = lookupMapsCache.get(rcProjectId);
  if (cached && cached.expiresAt > now) return cached.maps;

  const [entitlementsResult, productsResult] = await Promise.all([
    fetchRevenueCatProjectEntitlements(apiKey, rcProjectId),
    fetchRevenueCatProjectProducts(apiKey, rcProjectId),
  ]);

  const entitlementKeyById = new Map<string, string>();
  if (entitlementsResult.status === "found") {
    for (const e of entitlementsResult.items) {
      if (e.lookup_key) entitlementKeyById.set(e.id, e.lookup_key);
    }
  } else {
    log.warn(
      { rcProjectId, statusCode: entitlementsResult.statusCode, message: entitlementsResult.message },
      "RC project entitlements fetch failed (continuing with raw entitlement IDs)",
    );
  }

  const productSkuById = new Map<string, string>();
  if (productsResult.status === "found") {
    for (const p of productsResult.items) {
      if (p.store_identifier) productSkuById.set(p.id, p.store_identifier);
    }
  } else {
    log.warn(
      { rcProjectId, statusCode: productsResult.statusCode, message: productsResult.message },
      "RC project products fetch failed (continuing with raw product IDs)",
    );
  }

  const maps = { entitlementKeyById, productSkuById };
  if (entitlementsResult.status === "found" && productsResult.status === "found") {
    lookupMapsCache.set(rcProjectId, { maps, expiresAt: now + LOOKUP_MAPS_CACHE_TTL_MS });
  }
  return maps;
}

// A V2 secret API key is project-scoped and its project ID never changes, so
// caching the key → project-id resolution in-process saves one RC round-trip
// per background resync and per anonymous-id webhook event. 1-hour TTL is
// generous given the value is effectively immutable. Mirrors lookupMapsCache.
const PROJECT_ID_CACHE_TTL_MS = 60 * 60 * 1000;
const projectIdCache = new Map<string, { projectId: string; expiresAt: number }>();

// Exported for tests — between tests, fetch-mock targets change but the
// cache key (`api_key`) is constant, so without clearing the cache a later
// test would see an earlier test's resolved project ID.
export function clearRevenueCatProjectIdCache(): void {
  projectIdCache.clear();
}

/**
 * Resolve the RevenueCat project ID for a V2 secret API key, cached
 * in-process per key for 1 hour. Pure cache wrapper around
 * `fetchRevenueCatProjectId` — returns its result union so each caller logs
 * the failure once with its own context. Failures are NOT cached so a
 * transient outage doesn't poison subsequent lookups for the full TTL.
 */
export async function resolveRevenueCatProjectId(
  apiKey: string,
): Promise<FetchProjectIdResult> {
  const now = Date.now();
  const cached = projectIdCache.get(apiKey);
  if (cached && cached.expiresAt > now) {
    return { status: "found", projectId: cached.projectId };
  }

  const result = await fetchRevenueCatProjectId(apiKey);
  if (result.status === "found") {
    projectIdCache.set(apiKey, { projectId: result.projectId, expiresAt: now + PROJECT_ID_CACHE_TTL_MS });
  }
  return result;
}

/**
 * Fire-and-forget per-user resync against RC's V2 API. Used by webhook
 * handlers to refresh property + revenue state for affected users without
 * blocking the webhook ack. Resolves the RC project ID once, then fans out
 * across the user IDs and isolates per-user errors so one bad user doesn't
 * abort the rest. Errors are logged, never thrown — webhook callers must not
 * `await` this.
 */
export function resyncRevenueCatUsersInBackground(args: {
  db: Db;
  log: BackgroundResyncLog;
  projectId: string;
  config: RevenueCatConfig;
  userIds: string[];
  context: string;
  eventId?: string;
}): void {
  const { db, log, projectId, config, context, eventId } = args;
  // Defensive: RC anonymous IDs must never reach the sync path — it upserts
  // on (project_id, user_id), so a stray `$RCAnonymousID:*` from any caller
  // would resurrect a deleted phantom app_users row.
  const userIds = args.userIds.filter((id) => !id.startsWith(RC_ANONYMOUS_PREFIX));
  if (userIds.length === 0) return;
  void (async () => {
    try {
      const projectIdResult = await resolveRevenueCatProjectId(config.api_key);
      if (projectIdResult.status !== "found") {
        log.warn(
          {
            projectId,
            eventId,
            context,
            status: projectIdResult.status,
            statusCode: projectIdResult.status === "error" ? projectIdResult.statusCode : undefined,
          },
          "RC user resync aborted — could not resolve RevenueCat project",
        );
        return;
      }
      const rcProjectId = projectIdResult.projectId;
      // Build the entitlement_id → lookup_key + product_id → store_identifier
      // maps once before fan-out so each per-user sync gets the same
      // translation table without re-fetching.
      const lookups = await fetchRevenueCatLookupMaps({
        apiKey: config.api_key,
        rcProjectId,
        log,
      });
      await Promise.all(
        userIds.map(async (userId) => {
          try {
            const result = await syncRevenueCatUserProperties({
              db,
              log,
              projectId,
              rcProjectId,
              config,
              userId,
              lookups,
            });
            if (result.status === "not_found") {
              log.info(
                { projectId, userId, eventId, context },
                "RC user resync: user not found in RC (skipped)",
              );
            } else if (result.status === "error") {
              log.warn(
                {
                  projectId,
                  userId,
                  eventId,
                  context,
                  statusCode: result.statusCode,
                  message: result.message,
                },
                "RC user resync got RC error",
              );
            }
          } catch (err) {
            log.error(
              { err, projectId, userId, eventId, context },
              "RC user resync failed",
            );
          }
        }),
      );
    } catch (err) {
      log.error(
        { err, projectId, eventId, context },
        "RC user resync wrapper failed",
      );
    }
  })();
}
