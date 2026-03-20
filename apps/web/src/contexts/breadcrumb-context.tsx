"use client";

import { createContext, useContext, useState, useCallback } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbContextValue {
  breadcrumbs: BreadcrumbItem[];
  breadcrumbPath: string;
  setBreadcrumbs: (items: BreadcrumbItem[], path: string) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  breadcrumbs: [],
  breadcrumbPath: "",
  setBreadcrumbs: () => {},
});

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [breadcrumbs, setBreadcrumbsState] = useState<BreadcrumbItem[]>([]);
  const [breadcrumbPath, setBreadcrumbPath] = useState("");

  const setBreadcrumbs = useCallback((items: BreadcrumbItem[], path: string) => {
    setBreadcrumbsState(items);
    setBreadcrumbPath(path);
  }, []);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, breadcrumbPath, setBreadcrumbs }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs() {
  return useContext(BreadcrumbContext);
}
