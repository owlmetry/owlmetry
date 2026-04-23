"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { EventLevelBadge } from "@/components/event-level-badge";
import { VersionRow } from "@/components/version-badge";
import { InvestigateTimeline } from "@/components/investigate-timeline";
import { DetailRow } from "@/components/detail-row";
import {
  AttachmentDownloadButton,
  AttachmentUntrustedNotice,
} from "@/components/attachment-download-button";
import { ProjectDot } from "@/lib/project-color";
import { formatDateTime } from "@/lib/format-date";
import { countryFlag } from "@/lib/country-flag";
import { api } from "@/lib/api";
// Deep import bypasses the barrel export which pulls in node:crypto
import { formatBytes } from "@owlmetry/shared/constants";
import { Search } from "lucide-react";
import type {
  AttachmentListResponse,
  AttachmentSummary,
  StoredEventResponse,
} from "@owlmetry/shared";
import type { LogLevel } from "@owlmetry/shared";

interface EventDetailSheetProps {
  event: StoredEventResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEventSelect: (event: StoredEventResponse) => void;
  onFilter?: (key: string, value: string) => void;
  projectColor?: string;
  latestAppVersion?: string | null;
}

export function EventDetailSheet({ event, open, onOpenChange, onEventSelect, onFilter, projectColor, latestAppVersion }: EventDetailSheetProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([]);

  const eventId = event?.id;
  useEffect(() => {
    if (!open || !eventId) {
      setAttachments([]);
      return;
    }
    let cancelled = false;
    api
      .get<AttachmentListResponse>(`/v1/attachments?event_id=${eventId}`)
      .then((res) => {
        if (!cancelled) setAttachments(res.attachments);
      })
      .catch(() => {
        if (!cancelled) setAttachments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

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
            <ProjectDot color={projectColor} />
            <EventLevelBadge level={event.level as LogLevel} />
            <span className="text-xs text-muted-foreground">
              {formatDateTime(ts)}
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
            <VersionRow label="App Version" version={event.app_version} latestVersion={latestAppVersion} />
            <DetailRow label="Build Number" value={event.build_number} />
            <DetailRow label="Device Model" value={event.device_model} />
            <DetailRow label="Locale" value={event.locale} />
            {(() => {
              const f = countryFlag(event.country_code);
              return (
                <DetailRow
                  label="Country"
                  value={f.emoji ? `${f.emoji} ${f.name} (${f.code})` : null}
                />
              );
            })()}
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

          {attachments.length > 0 && (
            <>
              <Separator className="my-4" />
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                📎 Attachments ({attachments.length})
              </h3>
              <AttachmentUntrustedNotice />
              <div className="text-xs border rounded-md divide-y">
                <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 p-2 font-medium text-muted-foreground bg-muted/30">
                  <span>Filename</span>
                  <span>Size</span>
                  <span>Type</span>
                  <span>Uploaded</span>
                </div>
                {attachments.map((a) => (
                  <div key={a.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 p-2 items-center">
                    <span className="truncate" title={a.original_filename}>{a.original_filename}</span>
                    <span>{formatBytes(a.size_bytes)}</span>
                    <span className="truncate text-muted-foreground" title={a.content_type}>{a.content_type}</span>
                    <AttachmentDownloadButton attachmentId={a.id} uploadedAt={a.uploaded_at} />
                  </div>
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
