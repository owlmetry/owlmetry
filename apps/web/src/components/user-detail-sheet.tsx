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
import type { AppUserResponse } from "@owlmetry/shared";

interface UserDetailSheetProps {
  user: AppUserResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilter?: (key: string, value: string) => void;
}

export function UserDetailSheet({ user, open, onOpenChange, onFilter }: UserDetailSheetProps) {
  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[500px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
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
                      className="text-xs cursor-pointer hover:bg-accent"
                      onClick={() => onFilter?.("app_id", app.app_id)}
                    >
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
            <>
              <Separator className="my-4" />
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Properties
              </h3>
              <div className="space-y-1">
                {Object.entries(user.properties).map(([k, v]) => (
                  <DetailRow key={k} label={k} value={v} />
                ))}
              </div>
            </>
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
