import type { MetricPhase } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

type Tone = "red" | "blue" | "green" | "yellow" | "cyan";

const PHASE_META: Record<MetricPhase, { emoji: string; label: string; tone: Tone }> = {
  start: { emoji: "🚀", label: "start", tone: "blue" },
  complete: { emoji: "✅", label: "complete", tone: "green" },
  fail: { emoji: "❌", label: "fail", tone: "red" },
  cancel: { emoji: "🚫", label: "cancel", tone: "yellow" },
  record: { emoji: "📝", label: "record", tone: "cyan" },
};

interface MetricPhaseBadgeProps {
  phase: MetricPhase;
  size?: "sm" | "md";
}

export function MetricPhaseBadge({ phase, size = "sm" }: MetricPhaseBadgeProps) {
  const meta = PHASE_META[phase];
  return (
    <Badge variant="outline" tone={meta.tone} size={size}>
      {meta.emoji} {meta.label}
    </Badge>
  );
}
