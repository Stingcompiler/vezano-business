import { Suspense } from "react";

import { ReportClient } from "@/features/market/report-client";

/** MP-15 — متابعة بلاغ لصاحبه. */
export default async function MarketReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ReportClient reportId={id} />
    </Suspense>
  );
}
