import { Suspense } from "react";

import { CompareClient } from "@/features/market/compare-client";

/** ORD-07 — مقارنة العرض وقبوله أو رفضه (`?version=` النسخة المفتوحة). */
export default async function MarketComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CompareClient id={id} />
    </Suspense>
  );
}
