"use client";

import { useCallback } from "react";
import useSWR from "swr";
import type { NotificationsListResponse } from "@owlmetry/shared";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import { useUnreadNotifications } from "./use-unread-notifications";

interface UseNotificationsOpts {
  readState?: "unread" | "read" | "all";
  type?: string;
}

export function useNotifications(opts: UseNotificationsOpts = {}) {
  const qs = buildQueryString({
    read_state: opts.readState && opts.readState !== "all" ? opts.readState : undefined,
    type: opts.type,
  });
  const key = `/v1/notifications${qs ? `?${qs}` : ""}`;

  const { data, isLoading, mutate } = useSWR<NotificationsListResponse>(key);
  const unread = useUnreadNotifications();

  const markRead = useCallback(
    async (id: string) => {
      await api.patch(`/v1/notifications/${id}`, { read: true });
      await Promise.all([mutate(), unread.mutate()]);
    },
    [mutate, unread],
  );

  const markAllRead = useCallback(
    async (type?: string) => {
      await api.post("/v1/notifications/mark-all-read", type ? { type } : {});
      await Promise.all([mutate(), unread.mutate()]);
    },
    [mutate, unread],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.delete(`/v1/notifications/${id}`);
      await Promise.all([mutate(), unread.mutate()]);
    },
    [mutate, unread],
  );

  return {
    notifications: data?.notifications ?? [],
    cursor: data?.cursor ?? null,
    hasMore: data?.has_more ?? false,
    isLoading,
    mutate,
    markRead,
    markAllRead,
    remove,
  };
}
