import { Suspense } from "react";

import { ShipClient } from "@/features/market/ship-client";

/** ORD-08 — تجهيز وتسليم جزئي. */
export default async function MarketShipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ShipClient id={id} />
    </Suspense>
  );
}
