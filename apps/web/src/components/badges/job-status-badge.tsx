import type { JobStatus } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

interface JobStatusBadgeProps {
  status: JobStatus;
  size?: "sm" | "md";
}

export function JobStatusBadge({ status, size = "sm" }: JobStatusBadgeProps) {
  switch (status) {
    case "completed":
      return <Badge variant="default" tone="green" size={size}>completed</Badge>;
    case "failed":
      return <Badge variant="destructive" size={size}>failed</Badge>;
    case "running":
      return <Badge variant="default" tone="blue" size={size} className="animate-pulse">running</Badge>;
    case "cancelled":
      return <Badge variant="secondary" size={size}>cancelled</Badge>;
    case "pending":
      return <Badge variant="outline" size={size}>pending</Badge>;
  }
}
