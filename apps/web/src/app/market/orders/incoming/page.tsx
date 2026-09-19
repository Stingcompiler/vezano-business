import { Suspense } from "react";

import { IncomingClient } from "@/features/market/incoming-client";

/** ORD-04 — طلبات المورد الواردة. */
export default function MarketIncomingPage() {
  return (
    <Suspense fallback={null}>
      <IncomingClient />
    </Suspense>
  );
}
