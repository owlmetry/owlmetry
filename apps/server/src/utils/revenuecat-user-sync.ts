import { eq, and } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { ATTRIBUTION_SOURCE_PROPERTY, ATTRIBUTION_SOURCE_VALUES } from "@owlmetry/shared";
import { mergeUserProperties, selectUnsetProps } from "./user-properties.js";
import { mapRevenueCatAttributesToAttributionProperties } from "./attribution/revenuecat.js";
import {
  type RevenueCatConfig,
  mapSubscriberToProperties,
  fetchRevenueCatSubscriber,
  fetchRevenueCatSubscriptions,
  fetchRevenueCatCustomerAttributes,
  fetchRevenueCatProjectId,
  sumLifetimeRevenueUsd,
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
}): Promise<SyncRevenueCatUserResult> {
  const { db, log, projectId, rcProjectId, config, userId } = args;

  const subscriberResult = await fetchRevenueCatSubscriber(config.api_key, rcProjectId, userId);
  if (subscriberResult.status === "not_found") return { status: "not_found" };
  if (subscriberResult.status === "error") {
    return {
      status: "error",
      statusCode: subscriberResult.statusCode,
      message: subscriberResult.message,
    };
  }

  const [subsResult, attrsResult] = await Promise.all([
    fetchRevenueCatSubscriptions(config.api_key, rcProjectId, userId),
    fetchRevenueCatCustomerAttributes(config.api_key, rcProjectId, userId),
  ]);

  const subsData = subsResult.status === "found" ? subsResult.data : undefined;
  if (subsResult.status === "error") {
    log.warn(
      { userId, statusCode: subsResult.statusCode, message: subsResult.message },
      "RC subscriptions fetch failed (continuing with entitlements-only props)",
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

  // RC pre-computes per-subscription `total_revenue_in_usd` (refunds netted),
  // so summing is authoritative. When the subs fetch failed we leave the
  // existing column untouched — overwriting with 0 here would silently zero
  // out a paying user during a transient RC outage.
  const revenueUsd = subsResult.status === "found" ? sumLifetimeRevenueUsd(subsData) : null;
  const revenueUsdCents = revenueUsd === null ? null : Math.round(revenueUsd * 100);
  const subscriberProps = mapSubscriberToProperties(subscriberResult.data, subsData);
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
  const { db, log, projectId, config, userIds, context, eventId } = args;
  if (userIds.length === 0) return;
  void (async () => {
    try {
      const projectIdResult = await fetchRevenueCatProjectId(config.api_key);
      if (projectIdResult.status !== "found") {
        log.warn(
          { projectId, eventId, status: projectIdResult.status, context },
          "RC user resync aborted — could not resolve RevenueCat project",
        );
        return;
      }
      await Promise.all(
        userIds.map(async (userId) => {
          try {
            const result = await syncRevenueCatUserProperties({
              db,
              log,
              projectId,
              rcProjectId: projectIdResult.projectId,
              config,
              userId,
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
