"use client";

import type { ReactNode } from "react";
import type { AppUserResponse } from "@owlmetry/shared";
import { ATTRIBUTION_COLUMN_KEYS } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VersionBadge, pickLatestForUser } from "@/components/version-badge";
import { ProjectDot } from "@/lib/project-color";
import { CountryCell } from "@/components/country-flag";
import { BillingBadge } from "@/components/billing-badge";
import { AttributionBadge } from "@/components/attribution-badge";
import { formatDateTime } from "@/lib/format-date";
import { timeAgoOrDate } from "@/app/dashboard/_components/time-ago";

export interface UserColumnHelpers {
  appColorMap: Map<string, string>;
  appLatestVersionMap: Map<string, string | null>;
  projectInfoMap: Map<string, { name: string; color: string }>;
  /** Called when a user clicks into a cell to filter the list. */
  onFilterClick?: (key: string, value: string) => void;
}

export interface UserColumnDef {
  id: string;
  label: string;
  /** Picker grouping (e.g. "Apple Search Ads"). Omit for built-ins. */
  group?: string;
  headerClassName?: string;
  cellClassName?: string;
  render: (user: AppUserResponse, helpers: UserColumnHelpers) => ReactNode;
}

const BUILTIN_COLUMNS: Record<string, UserColumnDef> = {
  user_id: {
    id: "user_id",
    label: "User ID",
    cellClassName: "font-mono text-xs py-1.5",
    render: (user) => user.user_id,
  },
  type: {
    id: "type",
    label: "Type",
    headerClassName: "w-[100px]",
    cellClassName: "py-1.5",
    render: (user) =>
      user.is_anonymous ? (
        <Badge variant="secondary" className="text-xs">👻 anon</Badge>
      ) : (
        <Badge variant="default" className="text-xs">👤 real</Badge>
      ),
  },
  apps: {
    id: "apps",
    label: "Apps",
    headerClassName: "w-[180px]",
    cellClassName: "text-xs py-1.5 max-w-[180px]",
    render: (user, { appColorMap, projectInfoMap, onFilterClick }) => {
      const userProject = !user.apps?.length ? projectInfoMap.get(user.project_id) : null;
      return (
        <div className="flex flex-wrap gap-1">
          {user.apps && user.apps.length > 0 ? (
            user.apps.map((a) => (
              <Badge
                key={a.app_id}
                variant="outline"
                className="text-xs cursor-pointer hover:bg-accent flex items-center gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilterClick?.("app_id", a.app_id);
                }}
              >
                <ProjectDot color={appColorMap.get(a.app_id)} size={6} />
                {a.app_name}
              </Badge>
            ))
          ) : userProject ? (
            <Badge
              variant="outline"
              className="text-xs cursor-pointer hover:bg-accent flex items-center gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                onFilterClick?.("project_id", user.project_id);
              }}
            >
              <ProjectDot color={userProject.color} size={6} />
              {userProject.name}
            </Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      );
    },
  },
  version: {
    id: "version",
    label: "Version",
    headerClassName: "w-[90px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[110px]",
    render: (user, { appLatestVersionMap }) => (
      <VersionBadge
        version={user.last_app_version}
        latestVersion={pickLatestForUser(user.apps, appLatestVersionMap)}
      />
    ),
  },
  properties: {
    id: "properties",
    label: "Properties",
    headerClassName: "w-[200px]",
    cellClassName: "py-1.5",
    render: (user) => {
      if (!user.properties) return <span className="text-xs text-muted-foreground">-</span>;
      const otherEntries = Object.entries(user.properties).filter(
        ([k]) => !k.startsWith("rc_") && !k.startsWith("asa_") && !k.startsWith("_") && k !== "attribution_source",
      );
      return (
        <div className="flex flex-wrap items-center gap-1">
          <BillingBadge properties={user.properties} />
          <AttributionBadge properties={user.properties} />
          {otherEntries.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs">🏷️ +{otherEntries.length}</Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="space-y-0.5 text-xs">
                  {otherEntries.map(([k, v]) => (
                    <div key={k}>
                      <span className="text-muted-foreground">{k}:</span> {v}
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      );
    },
  },
  first_seen: {
    id: "first_seen",
    label: "First Seen",
    headerClassName: "w-[160px]",
    cellClassName: "text-xs py-1.5",
    render: (user) => (
      <span title={formatDateTime(user.first_seen_at)}>
        {timeAgoOrDate(user.first_seen_at, formatDateTime)}
      </span>
    ),
  },
  last_seen: {
    id: "last_seen",
    label: "Last Seen",
    headerClassName: "w-[160px]",
    cellClassName: "text-xs py-1.5",
    render: (user) => (
      <span title={formatDateTime(user.last_seen_at)}>
        {timeAgoOrDate(user.last_seen_at, formatDateTime)}
      </span>
    ),
  },
  country: {
    id: "country",
    label: "Country",
    headerClassName: "w-[80px]",
    cellClassName: "text-xs py-1.5",
    render: (user) => <CountryCell code={user.last_country_code} />,
  },
};

const attributionColumns: Record<string, UserColumnDef> = Object.fromEntries(
  ATTRIBUTION_COLUMN_KEYS.map((k) => [
    `attr:${k.propertyKey}`,
    {
      id: `attr:${k.propertyKey}`,
      label: k.label,
      group: k.source,
      headerClassName: "w-[160px]",
      cellClassName: "font-mono text-xs py-1.5 truncate max-w-[200px]",
      render: (user) => {
        const v = user.properties?.[k.propertyKey];
        return v ? <span title={v}>{v}</span> : <span className="text-muted-foreground">—</span>;
      },
    } satisfies UserColumnDef,
  ]),
);

export const USER_COLUMN_REGISTRY: Record<string, UserColumnDef> = {
  ...BUILTIN_COLUMNS,
  ...attributionColumns,
};

export const DEFAULT_USER_COLUMN_ORDER: string[] = [
  "user_id",
  "type",
  "apps",
  "version",
  "properties",
  "first_seen",
  "last_seen",
  "country",
];
