import { Suspense } from "react";

import { ReportClient } from "@/features/market/report-client";

/** MP-15 — بلاغ عن عرض أو انتحال (`?offer=` أو `?supplier=`). */
export default function MarketReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportClient />
    </Suspense>
  );
}
