export function serializeApiKey(k: {
  id: string; key_prefix: string; key_type: string; app_id: string | null;
  team_id: string; name: string; permissions: unknown;
  created_at: Date; updated_at: Date; last_used_at: Date | null; expires_at: Date | null;
}) {
  return {
    id: k.id,
    key_prefix: k.key_prefix,
    key_type: k.key_type,
    app_id: k.app_id,
    team_id: k.team_id,
    name: k.name,
    permissions: k.permissions,
    created_at: k.created_at.toISOString(),
    updated_at: k.updated_at.toISOString(),
    last_used_at: k.last_used_at?.toISOString() || null,
    expires_at: k.expires_at?.toISOString() || null,
  };
}
