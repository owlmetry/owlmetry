"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { DataMode } from "@owlmetry/shared";

const STORAGE_KEY = "owlmetry:data-mode";
const DEFAULT_MODE: DataMode = "production";

interface DataModeContextValue {
  dataMode: DataMode;
  setDataMode: (mode: DataMode) => void;
}

const DataModeContext = createContext<DataModeContextValue>({
  dataMode: DEFAULT_MODE,
  setDataMode: () => {},
});

export function DataModeProvider({ children }: { children: React.ReactNode }) {
  const [dataMode, setDataModeState] = useState<DataMode>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "production" || stored === "debug" || stored === "all") return stored;
    }
    return DEFAULT_MODE;
  });

  const setDataMode = useCallback((mode: DataMode) => {
    setDataModeState(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, []);

  return (
    <DataModeContext.Provider value={{ dataMode, setDataMode }}>
      {children}
    </DataModeContext.Provider>
  );
}

export function useDataMode() {
  return useContext(DataModeContext);
}
