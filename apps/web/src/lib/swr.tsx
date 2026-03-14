"use client";

import { SWRConfig } from "swr";
import { api } from "./api";

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (url: string) => api.get(url),
        revalidateOnFocus: true,
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
