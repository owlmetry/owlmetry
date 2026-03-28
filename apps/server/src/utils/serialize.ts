export function serializeApiKey(k: {
  id: string; key_prefix: string; key_type: string; app_id: string | null;
  team_id: string; name: string; created_by: string | null; permissions: unknown;
  created_at: Date; updated_at: Date; last_used_at: Date | null; expires_at: Date | null;
  app_name?: string | null; created_by_email?: string | null;
}) {
  return {
    id: k.id,
    key_prefix: k.key_prefix,
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
  id: string; app_id: string; user_id: string;
  is_anonymous: boolean; claimed_from: string[] | null;
  properties: Record<string, string> | null;
  first_seen_at: Date; last_seen_at: Date;
}) {
  return {
    id: u.id,
    app_id: u.app_id,
    user_id: u.user_id,
    is_anonymous: u.is_anonymous,
    claimed_from: u.claimed_from,
    properties: u.properties,
    first_seen_at: u.first_seen_at.toISOString(),
    last_seen_at: u.last_seen_at.toISOString(),
  };
}

export function serializeApp(a: {
  id: string; team_id: string; project_id: string;
  name: string; platform: string; bundle_id: string | null;
  client_key: string | null;
  created_at: Date; deleted_at: Date | null;
}) {
  return {
    id: a.id,
    team_id: a.team_id,
    project_id: a.project_id,
    name: a.name,
    platform: a.platform,
    bundle_id: a.bundle_id,
    client_key: a.client_key,
    created_at: a.created_at.toISOString(),
  };
}
