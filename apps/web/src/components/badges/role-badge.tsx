import type { TeamRole } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

const ROLE_META: Record<TeamRole, { emoji: string; label: string; variant: "default" | "secondary" | "outline" }> = {
  owner: { emoji: "👑", label: "owner", variant: "default" },
  admin: { emoji: "🛡️", label: "admin", variant: "secondary" },
  member: { emoji: "👤", label: "member", variant: "outline" },
};

interface RoleBadgeProps {
  role: TeamRole;
  size?: "sm" | "md";
}

export function RoleBadge({ role, size = "sm" }: RoleBadgeProps) {
  const meta = ROLE_META[role];
  return (
    <Badge variant={meta.variant} size={size}>
      {meta.emoji} {meta.label}
    </Badge>
  );
}
