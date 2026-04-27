import { Star } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

interface RatingBadgeProps {
  rating: number | null | undefined;
  count: number | null | undefined;
  currentVersionRating?: number | null;
  currentVersionRatingCount?: number | null;
  className?: string;
}

// Compact star + numeric badge meant to live next to the version badge on app cards
// and in dashboards. Tooltip surfaces the all-time vs current-version split.
export function RatingBadge({
  rating,
  count,
  currentVersionRating,
  currentVersionRatingCount,
  className,
}: RatingBadgeProps) {
  if (rating === null || rating === undefined || rating <= 0) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
        <Star className="h-3 w-3" /> No ratings yet
      </span>
    );
  }

  const reviewers = count ?? 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium",
            className,
          )}
        >
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          <span>{rating.toFixed(2)}</span>
          <span className="text-muted-foreground">({formatCount(reviewers)})</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          <div>All time: {rating.toFixed(2)} ★ ({reviewers.toLocaleString()} ratings)</div>
          {currentVersionRating !== undefined && currentVersionRating !== null && (
            <div>
              Current version: {currentVersionRating.toFixed(2)} ★
              {currentVersionRatingCount !== null && currentVersionRatingCount !== undefined
                ? ` (${currentVersionRatingCount.toLocaleString()} ratings)`
                : ""}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
