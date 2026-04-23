import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CountBadgeProps {
  children: ReactNode;
  className?: string;
  size?: "xs" | "sm";
}

export function CountBadge({ children, className, size = "xs" }: CountBadgeProps) {
  return (
    <Badge variant="secondary" size={size} className={cn("font-normal tabular-nums", className)}>
      {children}
    </Badge>
  );
}
