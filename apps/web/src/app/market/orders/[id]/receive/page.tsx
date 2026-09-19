import { Suspense } from "react";

import { ReceiveClient } from "@/features/market/receive-client";

/** ORD-09 — استلام جزئي ورفض كمية (`?shipment=`). */
export default async function MarketReceivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ReceiveClient id={id} />
    </Suspense>
  );
}
