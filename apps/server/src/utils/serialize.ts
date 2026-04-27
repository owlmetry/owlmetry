export function serializeApiKey(k: {
  id: string; secret: string; key_type: string; app_id: string | null;
  team_id: string; name: string; created_by: string | null; permissions: unknown;
  created_at: Date; updated_at: Date; last_used_at: Date | null; expires_at: Date | null;
  app_name?: string | null; created_by_email?: string | null;
}) {
  return {
    id: k.id,
    secret: k.secret,
    key_type: k.key_type,
    app_id: k.app_id,
    team_id: k.team_id,
    name: k.name,
    created_by: k.created_by,
    permissions: k.permissions,
    created_at: k.created_at.toISOString(),
    updated_at: k.updated_at.toISOString(),
    last_used_at: k.last_used_at?.toISOString() || null,
    expires_at: k.expires_at?.toISOString() || null,
    app_name: k.app_name ?? null,
    created_by_email: k.created_by_email ?? null,
  };
}

export function serializeAuditLog(a: {
  id: string; team_id: string; actor_type: string; actor_id: string;
  action: string; resource_type: string; resource_id: string;
  changes: unknown; metadata: unknown; timestamp: Date;
}) {
  return {
    id: a.id,
    team_id: a.team_id,
    actor_type: a.actor_type,
    actor_id: a.actor_id,
    action: a.action,
    resource_type: a.resource_type,
    resource_id: a.resource_id,
    changes: a.changes,
    metadata: a.metadata,
    timestamp: a.timestamp.toISOString(),
  };
}

export function serializeAppUser(u: {
  id: string; project_id: string; user_id: string;
  is_anonymous: boolean; claimed_from: string[] | null;
  properties: Record<string, string> | null;
  apps: Array<{ app_id: string; app_name: string; first_seen_at: Date; last_seen_at: Date }>;
  first_seen_at: Date; last_seen_at: Date;
  last_country_code?: string | null;
  last_app_version?: string | null;
}) {
  return {
    id: u.id,
    project_id: u.project_id,
    user_id: u.user_id,
    is_anonymous: u.is_anonymous,
    claimed_from: u.claimed_from,
    properties: u.properties,
    apps: u.apps.map((a) => ({
      app_id: a.app_id,
      app_name: a.app_name,
      first_seen_at: a.first_seen_at.toISOString(),
      last_seen_at: a.last_seen_at.toISOString(),
    })),
    first_seen_at: u.first_seen_at.toISOString(),
    last_seen_at: u.last_seen_at.toISOString(),
    last_country_code: u.last_country_code ?? null,
    last_app_version: u.last_app_version ?? null,
  };
}

export function serializeJobRun(r: {
  id: string; job_type: string; status: string;
  team_id: string | null; project_id: string | null;
  triggered_by: string; params: unknown; progress: unknown;
  result: unknown; error: string | null; notify: boolean;
  started_at: Date | null; completed_at: Date | null; created_at: Date;
}) {
  return {
    id: r.id,
    job_type: r.job_type,
    status: r.status,
    team_id: r.team_id,
    project_id: r.project_id,
    triggered_by: r.triggered_by,
    params: r.params,
    progress: r.progress,
    result: r.result,
    error: r.error,
    notify: r.notify,
    started_at: r.started_at?.toISOString() ?? null,
    completed_at: r.completed_at?.toISOString() ?? null,
    created_at: r.created_at.toISOString(),
  };
}

// --- Client secret lookup helpers ---
// These avoid duplicating the api_keys query across app/project routes.

import { eq, and, inArray, isNull, or, gt, asc } from "drizzle-orm";
import { apiKeys } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";

export async function getClientSecret(db: Db, appId: string): Promise<string | null> {
  const now = new Date();
  const [row] = await db
    .select({ secret: apiKeys.secret })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.app_id, appId),
        eq(apiKeys.key_type, "client"),
        isNull(apiKeys.deleted_at),
        or(isNull(apiKeys.expires_at), gt(apiKeys.expires_at, now)),
      ),
    )
    .orderBy(asc(apiKeys.created_at))
    .limit(1);
  return row?.secret ?? null;
}

export async function getClientSecretMap(db: Db, appIds: string[]): Promise<Map<string, string>> {
  if (appIds.length === 0) return new Map();
  const now = new Date();
  const rows = await db
    .select({ app_id: apiKeys.app_id, secret: apiKeys.secret })
    .from(apiKeys)
    .where(
      and(
        inArray(apiKeys.app_id, appIds),
        eq(apiKeys.key_type, "client"),
        isNull(apiKeys.deleted_at),
        or(isNull(apiKeys.expires_at), gt(apiKeys.expires_at, now)),
      ),
    )
    .orderBy(asc(apiKeys.created_at));
  const map = new Map<string, string>();
  for (const k of rows) {
    if (k.app_id && !map.has(k.app_id)) map.set(k.app_id, k.secret);
  }
  return map;
}

export function serializeApp(a: {
  id: string; team_id: string; project_id: string;
  name: string; platform: string; bundle_id: string | null;
  latest_app_version?: string | null;
  latest_app_version_updated_at?: Date | null;
  latest_app_version_source?: string | null;
  apple_app_store_id?: number | null;
  latest_rating?: string | number | null;
  latest_rating_count?: number | null;
  current_version_rating?: string | number | null;
  current_version_rating_count?: number | null;
  latest_rating_updated_at?: Date | null;
  client_secret?: string | null;
  created_at: Date; deleted_at: Date | null;
}) {
  // numeric columns come back as strings from postgres-js — convert to number for the API.
  const toNum = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined) return null;
    return typeof v === "number" ? v : Number.parseFloat(v);
  };
  return {
    id: a.id,
    team_id: a.team_id,
    project_id: a.project_id,
    name: a.name,
    platform: a.platform,
    bundle_id: a.bundle_id,
    latest_app_version: a.latest_app_version ?? null,
    latest_app_version_updated_at: a.latest_app_version_updated_at?.toISOString() ?? null,
    latest_app_version_source: (a.latest_app_version_source ?? null) as "app_store" | "computed" | null,
    apple_app_store_id: a.apple_app_store_id ?? null,
    latest_rating: toNum(a.latest_rating),
    latest_rating_count: a.latest_rating_count ?? null,
    current_version_rating: toNum(a.current_version_rating),
    current_version_rating_count: a.current_version_rating_count ?? null,
    latest_rating_updated_at: a.latest_rating_updated_at?.toISOString() ?? null,
    client_secret: a.client_secret ?? null,
    created_at: a.created_at.toISOString(),
  };
}
