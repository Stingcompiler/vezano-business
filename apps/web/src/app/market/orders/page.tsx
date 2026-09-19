import { Suspense } from "react";

import { OrdersClient } from "@/features/market/orders-client";

/** ORD-03 — طلبات المشتري. */
export default function MarketOrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersClient />
    </Suspense>
  );
}
