import { Suspense } from "react";

import { CartClient } from "@/features/market/cart-client";

/** ORD-01 — سلة ومسودة طلب (محلية). */
export default function MarketCartPage() {
  return (
    <Suspense fallback={null}>
      <CartClient />
    </Suspense>
  );
}
