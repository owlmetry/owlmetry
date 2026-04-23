import { Badge } from "@/components/ui/badge";

type ActionVariant = "default" | "secondary" | "destructive" | "outline";

const ACTION_META: Record<string, { emoji: string; label: string; variant: ActionVariant }> = {
  create: { emoji: "✨", label: "create", variant: "default" },
  update: { emoji: "✏️", label: "update", variant: "secondary" },
  delete: { emoji: "🗑️", label: "delete", variant: "destructive" },
};

interface AuditActionBadgeProps {
  action: string;
  size?: "sm" | "md";
}

export function AuditActionBadge({ action, size = "sm" }: AuditActionBadgeProps) {
  const meta = ACTION_META[action] ?? { emoji: "•", label: action, variant: "outline" as const };
  return (
    <Badge variant={meta.variant} size={size}>
      {meta.emoji} {meta.label}
    </Badge>
  );
}
