"use client";

import type { FunnelStepAnalytics } from "@owlmetry/shared";

interface FunnelChartProps {
  steps: FunnelStepAnalytics[];
}

export function FunnelChart({ steps }: FunnelChartProps) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">No funnel data</p>;
  }

  const maxUsers = steps[0].unique_users;

  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const widthPercent = maxUsers > 0 ? (step.unique_users / maxUsers) * 100 : 0;

        return (
          <div key={step.step_index}>
            {/* Step bar */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-5 shrink-0 text-right">
                {step.step_index + 1}
              </span>
              <span className="text-xs font-medium shrink-0 w-36 truncate" title={step.step_name}>
                {step.step_name}
              </span>
              <div className="flex-1 min-w-0">
                <div
                  className="h-7 rounded-md bg-primary/15 transition-all"
                  style={{ width: `${Math.max(widthPercent, 2)}%` }}
                />
              </div>
              <div className="shrink-0 text-right w-32 flex items-center gap-2 justify-end">
                <span className="text-sm font-semibold tabular-nums">
                  {step.unique_users.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums w-12">
                  {step.percentage}%
                </span>
              </div>
            </div>

            {/* Drop-off indicator between steps */}
            {i < steps.length - 1 && steps[i + 1].drop_off_count > 0 && (
              <div className="flex items-center gap-3 ml-8 mt-0.5 mb-0.5">
                <div className="flex-1 flex items-center gap-2 pl-2">
                  <div className="h-px flex-1 max-w-16 bg-red-300/40" />
                  <span className="text-[10px] text-red-500/70">
                    -{steps[i + 1].drop_off_count.toLocaleString()} ({steps[i + 1].drop_off_percentage}%)
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
