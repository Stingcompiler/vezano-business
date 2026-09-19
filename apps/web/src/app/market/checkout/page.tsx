import { Suspense } from "react";

import { CheckoutClient } from "@/features/market/checkout-client";

/** ORD-02 — مراجعة وإرسال طلب أو طلب سعر (`?supplier=`). */
export default function MarketCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutClient />
    </Suspense>
  );
}
