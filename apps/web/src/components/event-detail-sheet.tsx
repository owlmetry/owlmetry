"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EventLevelBadge } from "@/components/event-level-badge";
import { InvestigateTimeline } from "@/components/investigate-timeline";
import { Search, Filter, Copy, Check } from "lucide-react";
import type { StoredEventResponse } from "@owlmetry/shared";
import type { LogLevel } from "@owlmetry/shared";

interface EventDetailSheetProps {
  event: StoredEventResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEventSelect: (event: StoredEventResponse) => void;
  onFilter?: (key: string, value: string) => void;
}

function DetailRow({
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

export function EventDetailSheet({ event, open, onOpenChange, onEventSelect, onFilter }: EventDetailSheetProps) {
  const [showTimeline, setShowTimeline] = useState(false);

  // Reset timeline when sheet closes or event changes
  const handleOpenChange = (v: boolean) => {
    if (!v) setShowTimeline(false);
    onOpenChange(v);
  };

  if (!event) return null;

  const ts = new Date(event.timestamp);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-[500px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <EventLevelBadge level={event.level as LogLevel} />
            <span className="text-xs text-muted-foreground">
              {ts.toLocaleString()}
            </span>
          </div>
          <SheetTitle className="text-base font-medium mt-1 break-words">
            {event.message}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0 px-6 pb-6">
          <div className="space-y-1">
            <DetailRow label="ID" value={event.id} />
            <DetailRow label="App ID" value={event.app_id} onFilter={onFilter && event.app_id ? () => onFilter("app_id", event.app_id) : undefined} />
            <DetailRow label="Timestamp" value={new Date(event.timestamp).toISOString()} />
            <DetailRow label="Received At" value={new Date(event.received_at).toISOString()} />
            <DetailRow label="Level" value={event.level} onFilter={onFilter && event.level ? () => onFilter("level", event.level) : undefined} />
            <DetailRow label="Message" value={event.message} />
            <DetailRow label="User ID" value={event.user_id} onFilter={onFilter && event.user_id ? () => onFilter("user_id", event.user_id!) : undefined} />
            <DetailRow label="Session ID" value={event.session_id} onFilter={onFilter && event.session_id ? () => onFilter("session_id", event.session_id) : undefined} />
            <DetailRow label="Screen Name" value={event.screen_name} onFilter={onFilter && event.screen_name ? () => onFilter("screen_name", event.screen_name!) : undefined} />
            <DetailRow label="Source Module" value={event.source_module} />
            <DetailRow label="Environment" value={event.environment} onFilter={onFilter && event.environment ? () => onFilter("environment", event.environment!) : undefined} />
            <DetailRow label="OS Version" value={event.os_version} />
            <DetailRow label="App Version" value={event.app_version} />
            <DetailRow label="Build Number" value={event.build_number} />
            <DetailRow label="Device Model" value={event.device_model} />
            <DetailRow label="Locale" value={event.locale} />
            {event.is_dev && (
              <div className="flex justify-between gap-4 py-1.5">
                <span className="shrink-0 text-xs text-muted-foreground">🛠️ Dev Build</span>
                <span className="text-right text-xs font-medium text-yellow-600">Yes</span>
              </div>
            )}
          </div>

          {event.custom_attributes && Object.keys(event.custom_attributes).length > 0 && (
            <>
              <Separator className="my-4" />
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Custom Attributes
              </h3>
              <div className="space-y-1">
                {Object.entries(event.custom_attributes).map(([k, v]) => (
                  <DetailRow key={k} label={k} value={v} />
                ))}
              </div>
            </>
          )}

          <Separator className="my-4" />

          {!showTimeline ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowTimeline(true)}
            >
              <Search className="h-3.5 w-3.5 mr-2" />
              Investigate
            </Button>
          ) : (
            <InvestigateTimeline event={event} onEventSelect={onEventSelect} />
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
