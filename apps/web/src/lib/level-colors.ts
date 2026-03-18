import type { LogLevel } from "@owlmetry/shared";

export const levelColors: Record<LogLevel, { text: string; bg: string; border: string }> = {
  error: { text: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30" },
  warn: { text: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  info: { text: "text-cyan-500", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
  debug: { text: "text-gray-400", bg: "bg-gray-400/10", border: "border-gray-400/30" },
};
