import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

export function JobStatusBadge({ status, size = "sm" }: JobStatusBadgeProps) {
  switch (status) {
    case "completed":
      return <Badge variant="default" tone="green" size={size}>completed</Badge>;
    case "failed":
      return <Badge variant="destructive" size={size}>failed</Badge>;
    case "running":
      return <Badge variant="default" tone="blue" size={size} className={cn("animate-pulse")}>running</Badge>;
    case "cancelled":
      return <Badge variant="secondary" size={size}>cancelled</Badge>;
    case "pending":
      return <Badge variant="outline" size={size}>pending</Badge>;
    default:
      return <Badge variant="outline" size={size}>{status}</Badge>;
  }
}
