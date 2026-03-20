import type { LogLevel } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";
import { levelColors } from "@/lib/level-colors";
import { cn } from "@/lib/utils";

export function EventLevelBadge({ level }: { level: LogLevel }) {
  const colors = levelColors[level];
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[11px] font-medium uppercase",
        colors.text,
        colors.bg,
        colors.border
      )}
    >
      {level === "info" ? "ℹ️ info" : level === "debug" ? "🐛 debug" : level === "warn" ? "⚠️ warn" : "🔴 error"}
    </Badge>
  );
}
