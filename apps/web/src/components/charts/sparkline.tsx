"use client";

import { cn } from "@/lib/utils";

interface SparklineProps {
  /**
   * Series values in chronological order. The vertical axis is auto-scaled to
   * [min(values), max(values)]; we want the *shape* of the trend, not absolute
   * magnitude (the big number at the top of the card is already the magnitude
   * anchor). Empty / single-value / all-equal arrays render gracefully.
   */
  values: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  /**
   * Tailwind class that controls `currentColor`. Default is the same
   * semi-transparent foreground used across the rest of the dashboard chrome
   * so every sparkline reads as decoration, not as the focal element.
   */
  className?: string;
  /** When true, renders with `vector-effect="non-scaling-stroke"` so the line
   * keeps its visual thickness as the SVG is scaled via CSS. */
  nonScalingStroke?: boolean;
}

const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 24;
const DEFAULT_STROKE_WIDTH = 1;

/**
 * Deps-free SVG sparkline. Built around `preserveAspectRatio="none"` + a fixed
 * viewBox so the container drives layout (CSS width:100%, fixed h-6 on the
 * card) and the parent's flex/grid never has to negotiate intrinsic sizing.
 *
 * Edge cases:
 *  - `values.length === 0` → render nothing (caller is responsible for showing
 *    a skeleton state).
 *  - `values.length === 1` → render a single centered dot.
 *  - All values equal → flat line at vertical center.
 *  - All zeros → identical to the all-equal case (centered flat line).
 *
 * `aria-hidden` because the headline number above the card is already the
 * accessible label; the line is purely decorative.
 */
export function Sparkline({
  values,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  className,
  nonScalingStroke = true,
}: SparklineProps) {
  if (values.length === 0) return null;

  // Single-point case: a centered dot. We still emit an SVG so the slot in the
  // card layout is stable as data arrives.
  if (values.length === 1) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={cn("h-full w-full", className ?? "text-foreground/40")}
        aria-hidden
      >
        <circle
          cx={width / 2}
          cy={height / 2}
          r={Math.max(1, strokeWidth)}
          fill="currentColor"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  // Inset the line by half the stroke width so the top/bottom strokes don't
  // get clipped by the SVG edge.
  const inset = strokeWidth / 2;
  const yTop = inset;
  const yBottom = height - inset;
  const xLeft = 0;
  const xRight = width;

  const points: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = xLeft + (i / (values.length - 1)) * (xRight - xLeft);
    // Flat line at the vertical center when all values are equal — including
    // the all-zeros case. Avoids divide-by-zero and avoids drawing along the
    // bottom edge, which reads as "trending down to zero" visually.
    const y =
      range === 0
        ? (yTop + yBottom) / 2
        : yBottom - ((values[i] - min) / range) * (yBottom - yTop);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-full w-full", className ?? "text-foreground/40")}
      aria-hidden
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect={nonScalingStroke ? "non-scaling-stroke" : undefined}
      />
    </svg>
  );
}
