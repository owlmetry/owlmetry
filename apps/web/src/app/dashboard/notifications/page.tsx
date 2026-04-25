"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import type { NotificationResponse } from "@owlmetry/shared";
import {
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
} from "@owlmetry/shared/preferences";
import { useNotifications } from "@/hooks/use-notifications";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { ListSkeleton } from "@/components/ui/skeletons";
import { formatDateTime } from "@/lib/format-date";

export default function NotificationsPage() {
  const [readState, setReadState] = useState<"all" | "unread" | "read">("unread");
  const [type, setType] = useState<string>("all");

  const { notifications, isLoading, markRead, markAllRead, remove } = useNotifications({
    readState,
    type: type === "all" ? undefined : type,
  });

  const filterableTypes = useMemo(
    () => NOTIFICATION_TYPES.filter((t) => NOTIFICATION_TYPE_META[t].channels.length > 0),
    [],
  );

  return (
    <AnimatedPage>
      <StaggerItem index={0}>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead(type === "all" ? undefined : type)}
            disabled={notifications.length === 0}
          >
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
        </div>
      </StaggerItem>

      <StaggerItem index={1}>
        <div className="flex items-center gap-3">
          <Select value={readState} onValueChange={(v) => setReadState(v as typeof readState)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>

          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {filterableTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {NOTIFICATION_TYPE_META[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </StaggerItem>

      <StaggerItem index={2}>
        {isLoading ? (
          <ListSkeleton />
        ) : notifications.length === 0 ? (
          <EmptyInbox />
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                onMarkRead={() => markRead(n.id)}
                onRemove={() => remove(n.id)}
              />
            ))}
          </div>
        )}
      </StaggerItem>
    </AnimatedPage>
  );
}

function NotificationCard({
  notification,
  onMarkRead,
  onRemove,
}: {
  notification: NotificationResponse;
  onMarkRead: () => void;
  onRemove: () => void;
}) {
  const isUnread = !notification.read_at;
  const meta = (NOTIFICATION_TYPE_META as Record<string, { label: string }>)[notification.type];
  const label = meta?.label ?? notification.type;

  const Inner = (
    <Card className={isUnread ? "border-primary/40" : ""}>
      <CardContent className="flex items-start gap-3 py-4">
        <span
          className={
            isUnread
              ? "mt-1.5 block size-2 shrink-0 rounded-full bg-red-500"
              : "mt-1.5 block size-2 shrink-0 rounded-full bg-muted"
          }
          aria-label={isUnread ? "Unread" : undefined}
        />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" tone="gray" size="xs">
              {label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(notification.created_at)}
            </span>
          </div>
          <p className="text-sm font-medium">{notification.title}</p>
          {notification.body && (
            <p className="text-sm text-muted-foreground line-clamp-2">{notification.body}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isUnread && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMarkRead();
              }}
              title="Mark as read"
            >
              <CheckCheck className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }}
            title="Dismiss"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  if (notification.link) {
    return (
      <Link
        href={notification.link}
        onClick={() => {
          if (isUnread) onMarkRead();
        }}
        className="block"
      >
        {Inner}
      </Link>
    );
  }
  return Inner;
}

function EmptyInbox() {
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center text-center gap-2">
        <Bell className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">No notifications</p>
        <p className="text-xs text-muted-foreground max-w-md">
          You&apos;re all caught up. New issues, feedback, and job completion alerts will appear here.
        </p>
      </CardContent>
    </Card>
  );
}
