import { auditLogs } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import type { AuditAction, AuditResourceType } from "@owlmetry/shared";
import type { AuthContext } from "../types.js";

/**
 * Fire-and-forget audit log writer. Never blocks the request.
 */
export function logAuditEvent(
  db: Db,
  auth: AuthContext | null,
  entry: {
    team_id: string;
    action: AuditAction;
    resource_type: AuditResourceType;
    resource_id: string;
    changes?: Record<string, { before?: unknown; after?: unknown }>;
    metadata?: Record<string, unknown>;
  },
): void {
  const actor_type = !auth ? "system" : auth.type === "user" ? "user" : "api_key";
  const actor_id = !auth ? "system" : auth.type === "user" ? auth.user_id : auth.key_id;

  db.insert(auditLogs)
    .values({
      team_id: entry.team_id,
      actor_type,
      actor_id,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      changes: entry.changes ?? null,
      metadata: entry.metadata ?? null,
    })
    .execute()
    .catch(() => {});
}
