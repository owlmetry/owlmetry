import { PROJECT_COLOR_FALLBACK } from "@owlmetry/shared/project-colors";

interface ProjectDotProps {
  color: string | null | undefined;
  className?: string;
  size?: number;
}

export function ProjectDot({ color, className = "", size = 8 }: ProjectDotProps) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{
        backgroundColor: color ?? PROJECT_COLOR_FALLBACK,
        width: size,
        height: size,
      }}
    />
  );
}
