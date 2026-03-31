"use client";

import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Filter, Copy, Check } from "lucide-react";

export function DetailRow({
  label,
  value,
  onFilter,
  filterKey,
}: {
  label: string;
  value: string | null | undefined;
  onFilter?: () => void;
  filterKey?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group flex justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 min-w-0">
        <span className="text-right font-mono text-xs break-all">{value}</span>
        {onFilter && (
          <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onFilter}
                    className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Filter className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md">
                  Filter by {filterKey ?? label}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md">
                  {copied ? "Copied!" : "Copy"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        )}
      </span>
    </div>
  );
}
