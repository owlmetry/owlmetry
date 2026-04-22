import * as React from "react";

import { cn } from "@/lib/utils";

export function AnimatedPage({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-8 animate-fade-in-up", className)}>
      {children}
    </div>
  );
}

const STAGGER_CLASSES = [
  "animate-fade-in-up-stagger-1",
  "animate-fade-in-up-stagger-2",
  "animate-fade-in-up-stagger-3",
  "animate-fade-in-up-stagger-4",
  "animate-fade-in-up-stagger-5",
] as const;

export function StaggerItem({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  const clamped = Math.min(Math.max(index, 0), STAGGER_CLASSES.length - 1);
  return (
    <div className={cn(STAGGER_CLASSES[clamped], className)}>{children}</div>
  );
}
