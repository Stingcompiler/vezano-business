import { Suspense } from "react";

import { QuoteClient } from "@/features/market/quote-client";

/** ORD-06 — إعداد عرض سعر من المورد. */
export default async function MarketQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <QuoteClient id={id} />
    </Suspense>
  );
}
