import type { LogLevel } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

type Tone = "red" | "yellow" | "cyan" | "gray";

const LEVEL_META: Record<LogLevel, { label: string; tone: Tone }> = {
  info: { label: "ℹ️ info", tone: "cyan" },
  debug: { label: "🐛 debug", tone: "gray" },
  warn: { label: "⚠️ warn", tone: "yellow" },
  error: { label: "🔴 error", tone: "red" },
};

export function EventLevelBadge({ level, size = "sm" }: { level: LogLevel; size?: "sm" | "md" }) {
  const meta = LEVEL_META[level];
  return (
    <Badge variant="outline" tone={meta.tone} size={size} className="font-mono uppercase">
      {meta.label}
    </Badge>
  );
}
