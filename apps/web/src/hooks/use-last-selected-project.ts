"use client";

import { useCallback } from "react";

const keyFor = (teamId: string | null | undefined) =>
  teamId ? `owlmetry:last-project:${teamId}` : null;

export function useLastSelectedProject(teamId: string | null | undefined) {
  const read = useCallback((): string | null => {
    const k = keyFor(teamId);
    if (!k || typeof window === "undefined") return null;
    return localStorage.getItem(k);
  }, [teamId]);

  const write = useCallback((projectId: string) => {
    const k = keyFor(teamId);
    if (!k || typeof window === "undefined") return;
    if (projectId) localStorage.setItem(k, projectId);
    else localStorage.removeItem(k);
  }, [teamId]);

  return { read, write };
}
