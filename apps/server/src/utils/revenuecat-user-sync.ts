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
} from "./revenuecat.js";

interface SyncLog {
  warn(obj: Record<string, unknown>, msg: string): void;
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

  const subscriberProps = mapSubscriberToProperties(subscriberResult.data, subsData);
  const properties = { ...subscriberProps, ...attributionProps };
  await mergeUserProperties(db, projectId, userId, properties);

  return {
    status: "synced",
    properties,
    isActive: subscriberProps.rc_status === "active",
    attribution,
  };
}
