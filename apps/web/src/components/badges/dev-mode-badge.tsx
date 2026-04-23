import { Badge } from "@/components/ui/badge";

interface DevModeBadgeProps {
  size?: "sm" | "md";
}

export function DevModeBadge({ size = "sm" }: DevModeBadgeProps) {
  return <Badge variant="secondary" size={size}>🛠️ dev</Badge>;
}
