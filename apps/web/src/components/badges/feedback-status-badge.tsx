import type { FeedbackStatus } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

type Tone = "red" | "blue" | "green" | "gray";

export const FEEDBACK_STATUS_CONFIG: Record<FeedbackStatus, { label: string; emoji: string; tone: Tone }> = {
  new: { label: "New", emoji: "🆕", tone: "red" },
  in_review: { label: "In Review", emoji: "👀", tone: "blue" },
  addressed: { label: "Addressed", emoji: "✅", tone: "green" },
  dismissed: { label: "Dismissed", emoji: "🚫", tone: "gray" },
};

export const FEEDBACK_STATUS_COLUMNS: FeedbackStatus[] = [
  "new",
  "in_review",
  "addressed",
  "dismissed",
];

interface FeedbackStatusBadgeProps {
  status: FeedbackStatus;
  size?: "sm" | "md";
}

export function FeedbackStatusBadge({ status, size = "sm" }: FeedbackStatusBadgeProps) {
  const config = FEEDBACK_STATUS_CONFIG[status];
  return (
    <Badge variant="outline" tone={config.tone} size={size}>
      {config.emoji} {config.label}
    </Badge>
  );
}
