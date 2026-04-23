import { Badge } from "@/components/ui/badge";

interface IntegrationStatusBadgeProps {
  enabled: boolean;
  disabledLabel?: string;
  size?: "sm" | "md";
}

export function IntegrationStatusBadge({
  enabled,
  disabledLabel = "Disabled",
  size = "md",
}: IntegrationStatusBadgeProps) {
  return enabled ? (
    <Badge variant="default" tone="green" size={size}>Active</Badge>
  ) : (
    <Badge variant="secondary" size={size}>{disabledLabel}</Badge>
  );
}
