import { Suspense } from "react";

import { ReportClient } from "@/features/market/report-client";

/** MP-15 — بلاغاتي. */
export default function MarketReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportClient />
    </Suspense>
  );
}
