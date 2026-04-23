import type { AuditAction } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

const ACTION_META: Record<AuditAction, { emoji: string; variant: "default" | "secondary" | "destructive" }> = {
  create: { emoji: "✨", variant: "default" },
  update: { emoji: "✏️", variant: "secondary" },
  delete: { emoji: "🗑️", variant: "destructive" },
};

// AuditLogResponse.action is typed as `string` upstream, so accept the wider
// type and fall back when an unknown action shows up.
interface AuditActionBadgeProps {
  action: string;
  size?: "sm" | "md";
}

export function AuditActionBadge({ action, size = "sm" }: AuditActionBadgeProps) {
  const meta = ACTION_META[action as AuditAction];
  if (!meta) {
    return <Badge variant="outline" size={size}>• {action}</Badge>;
  }
  return (
    <Badge variant={meta.variant} size={size}>
      {meta.emoji} {action}
    </Badge>
  );
}
