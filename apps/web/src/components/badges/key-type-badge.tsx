import { Badge } from "@/components/ui/badge";

const KEY_TYPE_META: Record<string, { emoji: string; label: string; variant: "default" | "secondary" }> = {
  client: { emoji: "📱", label: "client", variant: "secondary" },
  agent: { emoji: "🕶️", label: "agent", variant: "default" },
  import: { emoji: "📦", label: "import", variant: "secondary" },
};

interface KeyTypeBadgeProps {
  keyType: string;
  size?: "sm" | "md";
}

export function KeyTypeBadge({ keyType, size = "sm" }: KeyTypeBadgeProps) {
  const meta = KEY_TYPE_META[keyType];
  if (!meta) {
    return <Badge variant="secondary" size={size}>{keyType}</Badge>;
  }
  return (
    <Badge variant={meta.variant} size={size}>
      {meta.emoji} {meta.label}
    </Badge>
  );
}
