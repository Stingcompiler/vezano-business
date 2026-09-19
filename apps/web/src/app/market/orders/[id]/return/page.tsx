import { Suspense } from "react";

import { ReturnClient } from "@/features/market/return-client";

/** ORD-11 — طلب مرتجع تجاري. */
export default async function MarketReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ReturnClient id={id} />
    </Suspense>
  );
}
