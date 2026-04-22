"use client";

import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DetailRow } from "@/components/detail-row";
import { ArrowRight } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";
import { ProjectDot } from "@/lib/project-color";
import { countryFlag } from "@/lib/country-flag";
import type { AppUserResponse } from "@owlmetry/shared";

interface UserDetailSheetProps {
  user: AppUserResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilter?: (key: string, value: string) => void;
  projectColorMap?: Map<string, string>;
  appColorMap?: Map<string, string>;
}

// Prefix-based grouping. Adding a future ad network (e.g. "meta_") is a
// one-line extension in `ATTRIBUTION_PREFIXES`. Cross-network keys (e.g.
// `attribution_source`) are listed explicitly.
const ATTRIBUTION_PREFIXES = ["asa_"];
const ATTRIBUTION_EXPLICIT_KEYS = new Set(["attribution_source"]);
const SUBSCRIPTION_PREFIXES = ["rc_"];

function isAttributionKey(key: string): boolean {
  if (ATTRIBUTION_EXPLICIT_KEYS.has(key)) return true;
  return ATTRIBUTION_PREFIXES.some((p) => key.startsWith(p));
}

function isSubscriptionKey(key: string): boolean {
  return SUBSCRIPTION_PREFIXES.some((p) => key.startsWith(p));
}

const ATTRIBUTION_SOURCE_LABELS: Record<string, string> = {
  apple_search_ads: "Apple Search Ads",
  none: "None",
};

function stripPrefixAndHumanize(key: string, prefixes: readonly string[]): string {
  const stripped = prefixes.reduce(
    (k, p) => (k.startsWith(p) ? k.slice(p.length) : k),
    key,
  );
  const words = stripped.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function humanizeAttributionKey(key: string): string {
  if (key === "attribution_source") return "Source";
  return stripPrefixAndHumanize(key, ATTRIBUTION_PREFIXES);
}

function PropertiesPanel({ properties }: { properties: Record<string, string> }) {
  const attribution: Array<[string, string]> = [];
  const subscription: Array<[string, string]> = [];
  const diagnostics: Array<[string, string]> = [];
  const other: Array<[string, string]> = [];

  for (const [k, v] of Object.entries(properties)) {
    // Underscore-prefixed keys are server-stamped diagnostics (e.g.
    // `_asa_enrichment_last_outcome`). Hide them from the main properties
    // list and render in a separate, collapsed-feel Diagnostics section.
    if (k.startsWith("_")) diagnostics.push([k, v]);
    else if (isAttributionKey(k)) attribution.push([k, v]);
    else if (isSubscriptionKey(k)) subscription.push([k, v]);
    else other.push([k, v]);
  }

  // Within Attribution, always surface `attribution_source` first.
  attribution.sort(([a], [b]) => {
    if (a === "attribution_source") return -1;
    if (b === "attribution_source") return 1;
    return a.localeCompare(b);
  });

  return (
    <>
      {attribution.length > 0 && (
        <>
          <Separator className="my-4" />
          <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Attribution
          </h3>
          <div className="space-y-1">
            {attribution.map(([k, v]) => {
              const label = humanizeAttributionKey(k);
              const value =
                k === "attribution_source" ? ATTRIBUTION_SOURCE_LABELS[v] ?? v : v;
              return <DetailRow key={k} label={label} value={value} />;
            })}
          </div>
        </>
      )}
      {subscription.length > 0 && (
        <>
          <Separator className="my-4" />
          <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Subscription
          </h3>
          <div className="space-y-1">
            {subscription.map(([k, v]) => (
              <DetailRow key={k} label={stripPrefixAndHumanize(k, SUBSCRIPTION_PREFIXES)} value={v} />
            ))}
          </div>
        </>
      )}
      {other.length > 0 && (
        <>
          <Separator className="my-4" />
          <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Properties
          </h3>
          <div className="space-y-1">
            {other.map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </div>
        </>
      )}
      {diagnostics.length > 0 && (
        <>
          <Separator className="my-4" />
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 list-none flex items-center gap-1">
              <span>Diagnostics ({diagnostics.length})</span>
              <span className="text-[10px] opacity-60">(click to expand)</span>
            </summary>
            <div className="space-y-1">
              {diagnostics.map(([k, v]) => (
                <DetailRow key={k} label={k.replace(/^_/, "")} value={v || "—"} />
              ))}
            </div>
          </details>
        </>
      )}
    </>
  );
}

export function UserDetailSheet({ user, open, onOpenChange, onFilter, projectColorMap, appColorMap }: UserDetailSheetProps) {
  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[500px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <ProjectDot color={projectColorMap?.get(user.project_id)} />
            {user.is_anonymous ? (
              <Badge variant="secondary" className="text-xs">👻 anon</Badge>
            ) : (
              <Badge variant="default" className="text-xs">👤 real</Badge>
            )}
          </div>
          <SheetTitle className="text-base font-medium mt-1 break-words font-mono">
            {user.user_id}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0 px-6 pb-6">
          <div className="space-y-1">
            <DetailRow label="User ID" value={user.user_id} onFilter={onFilter ? () => onFilter("search", user.user_id) : undefined} filterKey="user" />
            <DetailRow label="Internal ID" value={user.id} />
            <DetailRow
              label="Project ID"
              value={user.project_id}
              onFilter={onFilter ? () => onFilter("project_id", user.project_id) : undefined}
              filterKey="project"
            />
            <DetailRow label="First Seen" value={formatDateTime(user.first_seen_at)} />
            <DetailRow label="Last Seen" value={formatDateTime(user.last_seen_at)} />
            {(() => {
              const f = countryFlag(user.last_country_code);
              return f.emoji ? (
                <DetailRow label="Last Country" value={`${f.emoji} ${f.name} (${f.code})`} />
              ) : null;
            })()}
            {user.claimed_from && user.claimed_from.length > 0 && (
              <DetailRow label="Claimed From" value={user.claimed_from.join(", ")} />
            )}
          </div>

          {user.apps && user.apps.length > 0 && (
            <>
              <Separator className="my-4" />
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Apps
              </h3>
              <div className="space-y-3">
                {user.apps.map((app) => (
                  <div key={app.app_id} className="space-y-1">
                    <Badge
                      variant="outline"
                      className="text-xs cursor-pointer hover:bg-accent flex items-center gap-1.5 w-fit"
                      onClick={() => onFilter?.("app_id", app.app_id)}
                    >
                      <ProjectDot color={appColorMap?.get(app.app_id) ?? projectColorMap?.get(user.project_id)} size={6} />
                      {app.app_name}
                    </Badge>
                    <DetailRow label="First Seen" value={formatDateTime(app.first_seen_at)} />
                    <DetailRow label="Last Seen" value={formatDateTime(app.last_seen_at)} />
                  </div>
                ))}
              </div>
            </>
          )}

          {user.properties && Object.keys(user.properties).length > 0 && (
            <PropertiesPanel properties={user.properties} />
          )}

          <Separator className="my-4" />

          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link href={`/dashboard/events?project_id=${user.project_id}&user_id=${user.user_id}`}>
              <ArrowRight className="h-3.5 w-3.5 mr-2" />
              View Events
            </Link>
          </Button>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
