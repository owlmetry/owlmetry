import { cn } from "@/lib/utils";

interface DeltaIndicatorProps {
  delta: number | null | undefined;
  tone?: "muted" | "colored";
  className?: string;
}

// Hides on null/undefined/0 — keeps stable rows visually quiet.
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
