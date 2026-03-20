export type AuditActorType = "user" | "api_key" | "system";
export type AuditAction = "create" | "update" | "delete";
export type AuditResourceType =
  | "app"
  | "project"
  | "api_key"
  | "team"
  | "team_member"
  | "invitation"
  | "metric_definition"
  | "funnel_definition"
  | "user";

export const AUDIT_ACTIONS: AuditAction[] = ["create", "update", "delete"];
export const AUDIT_RESOURCE_TYPES: AuditResourceType[] = [
  "app", "project", "api_key", "team", "team_member",
  "invitation", "metric_definition", "funnel_definition", "user",
];

export interface AuditLogEntry {
  id: string;
  team_id: string;
  actor_type: AuditActorType;
  actor_id: string;
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id: string;
  changes: Record<string, { before?: unknown; after?: unknown }> | null;
  metadata: Record<string, unknown> | null;
  timestamp: Date;
}
