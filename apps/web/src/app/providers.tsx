"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { AppContextProvider } from "@/lib/app-context";

/** TanStack Query لبيانات الخادم فقط — ليست دفتر المبيعات المحلي (§٤.٥). */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            networkMode: "offlineFirst",
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AppContextProvider>{children}</AppContextProvider>
    </QueryClientProvider>
  );
}
