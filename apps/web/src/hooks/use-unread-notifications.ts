"use client";

import useSWR from "swr";
import type { NotificationsUnreadCountResponse } from "@owlmetry/shared";
import { useUser } from "./use-user";

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls /v1/notifications/unread-count every 30s for the user-menu badge.
 * Mutations on the notifications list page revalidate the same key for
 * instant badge updates.
 */
export function useUnreadNotifications() {
  const { user } = useUser();
  const { data, mutate } = useSWR<NotificationsUnreadCountResponse>(
    user ? "/v1/notifications/unread-count" : null,
    { refreshInterval: POLL_INTERVAL_MS },
  );
  return { count: data?.count ?? 0, mutate };
}
