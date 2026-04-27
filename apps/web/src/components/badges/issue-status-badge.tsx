import type { IssueStatus } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

type Tone = "red" | "blue" | "yellow" | "green" | "gray";

export const ISSUE_STATUS_CONFIG: Record<IssueStatus, { label: string; emoji: string; tone: Tone }> = {
  new: { label: "New", emoji: "🆕", tone: "red" },
  in_progress: { label: "In Progress", emoji: "🔧", tone: "blue" },
  regressed: { label: "Regressed", emoji: "🔄", tone: "yellow" },
  resolved: { label: "Resolved", emoji: "✅", tone: "green" },
  silenced: { label: "Silenced", emoji: "🔇", tone: "gray" },
};

export const ISSUE_STATUS_COLUMNS: IssueStatus[] = [
  "new",
  "regressed",
  "in_progress",
  "resolved",
  "silenced",
];

interface IssueStatusBadgeProps {
  status: IssueStatus;
  size?: "sm" | "md";
}

export function IssueStatusBadge({ status, size = "sm" }: IssueStatusBadgeProps) {
  const config = ISSUE_STATUS_CONFIG[status];
  return (
    <Badge variant="outline" tone={config.tone} size={size}>
      {config.emoji} {config.label}
    </Badge>
  );
}
