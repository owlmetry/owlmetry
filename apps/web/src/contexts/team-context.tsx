"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useUser } from "@/hooks/use-user";
import type { AuthTeamMembership } from "@owlmetry/shared";

const STORAGE_KEY = "owlmetry:current-team";

interface TeamContextValue {
  currentTeam: AuthTeamMembership | null;
  currentRole: AuthTeamMembership["role"] | null;
  teams: AuthTeamMembership[];
  setCurrentTeam: (id: string) => void;
}

const TeamContext = createContext<TeamContextValue>({
  currentTeam: null,
  currentRole: null,
  teams: [],
  setCurrentTeam: () => {},
});

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const { teams: userTeams } = useUser();
  const teams = userTeams ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setSelectedId(stored);
  }, []);

  const setCurrentTeam = useCallback((id: string) => {
    setSelectedId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  // Resolve the current team — fall back to first if stored ID is invalid
  const currentTeam =
    teams.find((t) => t.id === selectedId) ?? teams[0] ?? null;

  // Sync localStorage if we fell back
  useEffect(() => {
    if (currentTeam && currentTeam.id !== selectedId) {
      setSelectedId(currentTeam.id);
      localStorage.setItem(STORAGE_KEY, currentTeam.id);
    }
  }, [currentTeam, selectedId]);

  return (
    <TeamContext.Provider
      value={{
        currentTeam,
        currentRole: currentTeam?.role ?? null,
        teams,
        setCurrentTeam,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
