"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { sinceFromRange } from "@/lib/time-ranges";

export interface UrlFilterConfig {
  /** Default values for each filter field. Fields not listed here are ignored. */
  defaults: Record<string, string>;
  /** The base path for URL replacement (e.g. "/dashboard/events"). */
  path: string;
  /** Keys that survive clearFilters and are excluded from hasActiveFilters (e.g. ["project_id"]). */
  persistKeys?: string[];
}

export interface UrlFilters {
  /** Current value for any filter field. */
  get: (key: string) => string;
  /** Update a single filter value (updates state + URL). */
  set: (key: string, value: string) => void;
  /** Update multiple filter values at once. */
  setMany: (updates: Record<string, string>) => void;
  /** Whether any filter differs from its default. */
  hasActiveFilters: boolean;
  /** Reset all filters to defaults and clear URL params. */
  clearFilters: () => void;

  // Time range convenience helpers (only meaningful when config has time_range/since/until)
  /** ISO since string computed from time_range preset or sinceInput. */
  computedSince: string | undefined;
  /** ISO until string computed from untilInput (start of next day). */
  computedUntil: string | undefined;
  /** Handle time range change: clears since/until when switching to a preset. */
  handleTimeRangeChange: (value: string) => void;
  /** Handle date input change: sets time_range to "custom" when a date is entered. */
  handleDateChange: (field: "since" | "until", value: string) => void;

  /** All current values as a Record. */
  values: Record<string, string>;
}

export function useUrlFilters(config: UrlFilterConfig): UrlFilters {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { defaults, path, persistKeys } = config;
  const persistSet = useMemo(() => new Set(persistKeys ?? []), [persistKeys]);

  // Initialize state from URL params, falling back to defaults
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of Object.keys(defaults)) {
      initial[key] = searchParams.get(key) ?? defaults[key];
    }
    return initial;
  });

  // Track whether this is the initial render to avoid replacing URL on mount
  // when nothing has changed
  const isInitialRender = useRef(true);

  const get = useCallback((key: string) => values[key] ?? defaults[key] ?? "", [values, defaults]);

  const buildUrl = useCallback(
    (vals: Record<string, string>) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(vals)) {
        if (!value) continue;
        if (value === defaults[key] && !persistSet.has(key)) continue;
        params.set(key, value);
      }
      const qs = params.toString();
      return `${path}${qs ? `?${qs}` : ""}`;
    },
    [defaults, path, persistSet],
  );

  const updateUrl = useCallback(
    (vals: Record<string, string>) => {
      router.replace(buildUrl(vals), { scroll: false });
    },
    [buildUrl, router],
  );

  const set = useCallback(
    (key: string, value: string) => {
      setValues((prev) => {
        const next = { ...prev, [key]: value };
        // Defer URL update to after state settles
        return next;
      });
    },
    [],
  );

  const setMany = useCallback(
    (updates: Record<string, string>) => {
      setValues((prev) => ({ ...prev, ...updates }));
    },
    [],
  );

  // Sync URL whenever values change
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      // Only update URL on initial render if URL params differ from current values
      // (i.e., we resolved defaults that aren't in the URL)
      const currentUrl = buildUrl(values);
      const currentQs = new URLSearchParams();
      searchParams.forEach((v, k) => {
        if (Object.keys(defaults).includes(k)) currentQs.set(k, v);
      });
      const existingUrl = `${path}${currentQs.toString() ? `?${currentQs.toString()}` : ""}`;
      if (currentUrl !== existingUrl) {
        updateUrl(values);
      }
      return;
    }
    updateUrl(values);
  }, [values]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasActiveFilters = useMemo(() => {
    return Object.keys(defaults).some((key) => {
      if (persistSet.has(key)) return false;
      const current = values[key] ?? "";
      const def = defaults[key] ?? "";
      return current !== def;
    });
  }, [values, defaults, persistSet]);

  const clearFilters = useCallback(() => {
    setValues((prev) => {
      const next = { ...defaults };
      for (const key of persistSet) {
        if (prev[key] !== undefined) next[key] = prev[key];
      }
      return next;
    });
  }, [defaults, persistSet]);

  // Time range helpers
  const computedSince = useMemo(() => {
    const sinceInput = values.since ?? "";
    const timeRange = values.time_range ?? "";
    if (sinceInput) return new Date(sinceInput).toISOString();
    if (timeRange === "custom") return undefined;
    if (timeRange) return sinceFromRange(timeRange);
    return undefined;
  }, [values.since, values.time_range]);

  const computedUntil = useMemo(() => {
    const untilInput = values.until ?? "";
    if (!untilInput) return undefined;
    const d = new Date(untilInput);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  }, [values.until]);

  const handleTimeRangeChange = useCallback(
    (value: string) => {
      if (value !== "custom") {
        setValues((prev) => ({ ...prev, time_range: value, since: "", until: "" }));
      } else {
        set("time_range", value);
      }
    },
    [set],
  );

  const handleDateChange = useCallback(
    (field: "since" | "until", value: string) => {
      setValues((prev) => ({
        ...prev,
        [field]: value,
        ...(value ? { time_range: "custom" } : {}),
      }));
    },
    [],
  );

  return {
    get,
    set,
    setMany,
    hasActiveFilters,
    clearFilters,
    computedSince,
    computedUntil,
    handleTimeRangeChange,
    handleDateChange,
    values,
  };
}
