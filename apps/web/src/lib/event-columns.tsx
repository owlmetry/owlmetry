"use client";

import type { ReactNode } from "react";
import type { LogLevel, StoredEventResponse } from "@owlmetry/shared";
import { EventLevelBadge } from "@/components/event-level-badge";
import { VersionBadge } from "@/components/version-badge";
import { CountryCell } from "@/components/country-flag";
import { ProjectDot } from "@/lib/project-color";
import { formatShortDate, formatTime, formatDateTime } from "@/lib/format-date";

export interface EventColumnHelpers {
  appNameMap: Map<string, string>;
  appColorMap: Map<string, string | undefined>;
  appLatestVersionMap: Map<string, string | null>;
}

export interface EventColumnDef {
  id: string;
  label: string;
  /** Optional grouping shown in the column picker. Omit for built-ins. */
  group?: string;
  headerClassName?: string;
  cellClassName?: string;
  render: (event: StoredEventResponse, helpers: EventColumnHelpers) => ReactNode;
}

export const EVENT_COLUMN_REGISTRY: Record<string, EventColumnDef> = {
  timestamp: {
    id: "timestamp",
    label: "Time",
    headerClassName: "w-[100px]",
    cellClassName: "font-mono text-xs py-1.5",
    render: (event) => {
      const ts = new Date(event.timestamp);
      return (
        <span title={formatDateTime(ts)}>
          {formatTime(ts)} {formatShortDate(ts)}
        </span>
      );
    },
  },
  level: {
    id: "level",
    label: "Level",
    headerClassName: "w-[90px]",
    cellClassName: "py-1.5",
    render: (event) => <EventLevelBadge level={event.level as LogLevel} />,
  },
  message: {
    id: "message",
    label: "Message",
    cellClassName: "font-mono text-xs py-1.5 truncate",
    render: (event) => event.message,
  },
  app: {
    id: "app",
    label: "App",
    headerClassName: "w-[140px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[140px]",
    render: (event, { appNameMap, appColorMap }) => (
      <span className="flex items-center gap-1.5">
        <ProjectDot color={appColorMap.get(event.app_id)} size={6} />
        <span className="truncate">{appNameMap.get(event.app_id) ?? event.app_id}</span>
      </span>
    ),
  },
  version: {
    id: "version",
    label: "Version",
    headerClassName: "w-[90px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[110px]",
    render: (event, { appLatestVersionMap }) => (
      <VersionBadge
        version={event.app_version}
        latestVersion={appLatestVersionMap.get(event.app_id) ?? undefined}
      />
    ),
  },
  environment: {
    id: "environment",
    label: "Environment",
    headerClassName: "w-[100px]",
    cellClassName: "text-xs py-1.5",
    render: (event) => event.environment ?? "—",
  },
  country: {
    id: "country",
    label: "Country",
    headerClassName: "w-[80px]",
    cellClassName: "text-xs py-1.5",
    render: (event) => <CountryCell code={event.country_code} />,
  },
  user_id: {
    id: "user_id",
    label: "User ID",
    headerClassName: "w-[140px]",
    cellClassName: "font-mono text-xs py-1.5 truncate max-w-[140px]",
    render: (event) => event.user_id ?? "—",
  },
  screen: {
    id: "screen",
    label: "Screen",
    headerClassName: "w-[120px]",
    cellClassName: "text-xs py-1.5 truncate max-w-[120px]",
    render: (event) => event.screen_name ?? "—",
  },
};

export const DEFAULT_EVENT_COLUMN_ORDER: string[] = [
  "timestamp",
  "level",
  "message",
  "app",
  "version",
  "environment",
  "country",
  "user_id",
  "screen",
];
