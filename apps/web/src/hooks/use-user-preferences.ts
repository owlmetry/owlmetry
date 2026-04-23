"use client";

import { useCallback, useEffect } from "react";
import type { MeResponse, UserPreferences } from "@owlmetry/shared";
import { useUser } from "./use-user";
import { api } from "@/lib/api";

const CACHE_KEY = "owlmetry:prefs:v1";

function readCache(): UserPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as UserPreferences) : null;
  } catch {
    return null;
  }
}

function writeCache(prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private browsing */
  }
}

/**
 * Per-user UI preferences. Reads from /v1/auth/me via SWR; mirrors into
 * localStorage so page loads don't flash the default column layout before
 * SWR hydrates.
 *
 * Defaults: when the user has never set a preference, the column order is
 * undefined and pages fall back to the code-level defaults — no migration
 * work when adding new built-in columns.
 */
export function useUserPreferences() {
  const { user } = useUser();
  const cached = readCache();
  const prefs: UserPreferences = user?.preferences ?? cached ?? {};

  useEffect(() => {
    if (user?.preferences) writeCache(user.preferences);
  }, [user?.preferences]);

  return prefs;
}

/**
 * Optimistic PATCH to /v1/auth/me. Mutates the SWR cache in place and
 * re-validates in the background. If the request fails, SWR's revalidation
 * will pull the server's truth back.
 */
export function useUpdateUserPreferences() {
  const { mutate } = useUser();

  return useCallback(
    async (patch: Partial<UserPreferences>) => {
      await mutate(
        (prev?: MeResponse) => {
          if (!prev) return prev;
          const nextPrefs = mergePrefs(prev.user.preferences, patch);
          writeCache(nextPrefs);
          return { ...prev, user: { ...prev.user, preferences: nextPrefs } };
        },
        { revalidate: false },
      );
      try {
        const res = await api.patch<{ user: MeResponse["user"] }>("/v1/auth/me", { preferences: patch });
        writeCache(res.user.preferences);
        await mutate();
      } catch {
        // Revalidate so the cache reflects server truth after a failed write.
        await mutate();
      }
    },
    [mutate],
  );
}

function mergePrefs(existing: UserPreferences | undefined, patch: Partial<UserPreferences>): UserPreferences {
  const base = existing ?? {};
  const merged: UserPreferences = { ...base };
  if (patch.version !== undefined) merged.version = patch.version;
  if (patch.ui !== undefined) {
    merged.ui = { ...base.ui };
    if (patch.ui.columns !== undefined) {
      merged.ui.columns = { ...base.ui?.columns, ...patch.ui.columns };
    }
  }
  return merged;
}
