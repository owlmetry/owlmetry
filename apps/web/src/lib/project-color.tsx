/**
 * Deterministic color assignment for projects (and their apps).
 * Same project ID always maps to the same color, so apps belonging
 * to the same project visually group across the dashboard.
 */

export const PROJECT_COLORS: readonly string[] = [
  // red
  "#ef4444", "#f87171", "#dc2626",
  // orange
  "#f97316", "#fb923c", "#ea580c",
  // amber
  "#f59e0b", "#d97706", "#fbbf24",
  // lime
  "#65a30d", "#84cc16", "#a3e635",
  // green
  "#22c55e", "#16a34a", "#4ade80",
  // emerald
  "#10b981", "#059669", "#34d399",
  // teal
  "#14b8a6", "#0d9488", "#2dd4bf",
  // cyan
  "#06b6d4", "#0891b2", "#22d3ee",
  // sky
  "#0ea5e9", "#0284c7", "#38bdf8",
  // blue
  "#3b82f6", "#2563eb", "#60a5fa",
  // indigo
  "#6366f1", "#4f46e5", "#818cf8",
  // violet
  "#8b5cf6", "#7c3aed", "#a78bfa",
  // purple
  "#a855f7", "#9333ea", "#c084fc",
  // fuchsia
  "#d946ef", "#c026d3", "#e879f9",
  // pink
  "#ec4899", "#db2777", "#f472b6",
  // rose
  "#f43f5e", "#e11d48", "#fb7185",
  // warm neutrals to reach 50
  "#a16207", "#92400e",
];

const FALLBACK = "#64748b";

export function getProjectColor(projectId: string | null | undefined): string {
  if (!projectId) return FALLBACK;
  let sum = 0;
  for (let i = 0; i < projectId.length; i++) sum += projectId.charCodeAt(i);
  return PROJECT_COLORS[sum % PROJECT_COLORS.length];
}

interface ProjectDotProps {
  projectId: string | null | undefined;
  className?: string;
  size?: number;
}

export function ProjectDot({ projectId, className = "", size = 8 }: ProjectDotProps) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{
        backgroundColor: getProjectColor(projectId),
        width: size,
        height: size,
      }}
    />
  );
}
