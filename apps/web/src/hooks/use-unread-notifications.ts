"use client";

import useSWR from "swr";
import type { NotificationsUnreadCountResponse } from "@owlmetry/shared";
import { useUser } from "./use-user";

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls /v1/notifications/unread-count every 30s for the user-menu badge.
 * `compare` prevents unnecessary re-renders when the count is unchanged.
 */
export function useUnreadNotifications() {
  const { user } = useUser();
  const { data, mutate } = useSWR<NotificationsUnreadCountResponse>(
    user ? "/v1/notifications/unread-count" : null,
    {
      refreshInterval: POLL_INTERVAL_MS,
      compare: (a, b) => a?.count === b?.count,
    },
  );
  return { count: data?.count ?? 0, mutate };
}
