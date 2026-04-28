import { cn } from "@/lib/utils";

interface DeltaIndicatorProps {
  delta: number | null | undefined;
  // "muted" → text-muted-foreground; "colored" → emerald (positive) / red (negative).
  // Defaults to "colored" since most surfaces want the green/red signal; the
  // dashboard StatCard opts into "muted".
  tone?: "muted" | "colored";
  className?: string;
}

// Renders "+1,234" / "-1,234" next to a count. Hides when no signal (null,
// undefined, or 0) — keeps the surrounding row visually quiet on first-day
// data and on stable counts.
export function DeltaIndicator({ delta, tone = "colored", className }: DeltaIndicatorProps) {
  if (delta == null || delta === 0) return null;
  const formatted = delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
  const toneClass =
    tone === "muted"
      ? "text-muted-foreground"
      : delta > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";
  return (
    <span className={cn("ml-1 tabular-nums", toneClass, className)}>{formatted}</span>
  );
}
