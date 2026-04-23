import type { MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { ProjectDot } from "@/lib/project-color";
import { cn } from "@/lib/utils";

interface AppBadgeProps {
  name: string;
  color: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
  /**
   * When provided the badge becomes clickable. The click event has
   * `stopPropagation` called so clicks inside a clickable row don't bubble.
   */
  onClick?: () => void;
}

export function AppBadge({ name, color, size = "sm", className, onClick }: AppBadgeProps) {
  const handleClick = onClick
    ? (e: MouseEvent<HTMLSpanElement>) => {
        e.stopPropagation();
        onClick();
      }
    : undefined;
  return (
    <Badge
      variant="outline"
      size={size}
      className={cn("gap-1.5", onClick && "cursor-pointer hover:bg-accent", className)}
      onClick={handleClick}
    >
      <ProjectDot color={color} size={6} />
      <span className="truncate">{name}</span>
    </Badge>
  );
}
