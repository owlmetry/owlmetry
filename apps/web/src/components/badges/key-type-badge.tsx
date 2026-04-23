import type { ApiKeyType } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

const KEY_TYPE_META: Record<ApiKeyType, { emoji: string; variant: "default" | "secondary" }> = {
  client: { emoji: "📱", variant: "secondary" },
  agent: { emoji: "🕶️", variant: "default" },
  import: { emoji: "📦", variant: "secondary" },
};

interface KeyTypeBadgeProps {
  keyType: ApiKeyType;
  size?: "sm" | "md";
}

export function KeyTypeBadge({ keyType, size = "sm" }: KeyTypeBadgeProps) {
  const meta = KEY_TYPE_META[keyType];
  return (
    <Badge variant={meta.variant} size={size}>
      {meta.emoji} {keyType}
    </Badge>
  );
}
