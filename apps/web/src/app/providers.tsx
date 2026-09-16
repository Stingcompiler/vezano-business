"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { setUnauthorizedHandler } from "@/lib/api";
import { AppContextProvider, useApp } from "@/lib/app-context";

/** 401 على مسار مُصادَق → ACC-08: تُصان الجلسة المحلية والعمل المعلّق، ويُطلب التحقق. */
function SessionGuard({ children }: { children: ReactNode }) {
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (pathname.startsWith("/session-expired")) return;
      app.markExpired();
      router.replace(`/session-expired?return=${encodeURIComponent(pathname)}`);
    });
    return () => setUnauthorizedHandler(null);
  }, [app, pathname, router]);
  return <>{children}</>;
}

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
      <AppContextProvider>
        <SessionGuard>{children}</SessionGuard>
      </AppContextProvider>
    </QueryClientProvider>
  );
}
