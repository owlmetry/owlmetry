"use client";

import { SWRConfig } from "swr";
import { api } from "./api";

const swrConfig = {
  fetcher: (url: string) => api.get(url),
  revalidateOnFocus: true,
  shouldRetryOnError: false,
};

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={swrConfig}>{children}</SWRConfig>;
}
