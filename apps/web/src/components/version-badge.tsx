// Deep import bypasses the barrel export which pulls in node:crypto
import { compareVersions, isLatestVersion } from "@owlmetry/shared/version";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// For a user belonging to N apps, pick the highest known latest_app_version
// among those apps. Returning the max (rather than e.g. requiring every app
// to be on its own latest) means: green badge as soon as the user is on the
// most recent release of any of their apps. Skips apps with no known latest.
export function pickLatestForUser(
  apps: { app_id: string }[],
  appLatestVersionMap: Map<string, string | null>,
): string | null {
  let max: string | null = null;
  for (const a of apps) {
    const v = appLatestVersionMap.get(a.app_id);
    if (!v) continue;
    if (max === null || compareVersions(v, max) > 0) max = v;
  }
  return max;
}

// Detail-row layout matching DetailRow but rendering a VersionBadge instead of
// a plain string. DetailRow can't be reused directly because it owns a copy
// button keyed on a string value.
export function VersionRow({
  label,
  version,
  latestVersion,
}: {
  label: string;
  version: string | null | undefined;
  latestVersion: string | null | undefined;
}) {
  if (!version) return null;
  return (
    <div className="group flex justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <VersionBadge version={version} latestVersion={latestVersion} />
    </div>
  );
}

interface VersionBadgeProps {
  version: string | null | undefined;
  latestVersion: string | null | undefined;
  className?: string;
}

export function VersionBadge({ version, latestVersion, className }: VersionBadgeProps) {
  if (!version) {
    return <span className={cn("font-mono text-xs text-muted-foreground", className)}>—</span>;
  }

  const isLatest = isLatestVersion(version, latestVersion ?? null);

  if (isLatest === null) {
    return <span className={cn("font-mono text-xs", className)}>{version}</span>;
  }

  const colorClasses = isLatest
    ? "text-green-500 bg-green-500/10 border-green-500/30"
    : "text-amber-500 bg-amber-500/10 border-amber-500/30";

  const tooltipText = isLatest
    ? "On the latest released version"
    : `Older than the latest released version (v${latestVersion})`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn("font-mono text-[11px] font-medium", colorClasses, className)}
        >
          {version}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
