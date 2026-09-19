import { Suspense } from "react";

import { UnavailableClient } from "@/features/market/unavailable-client";

/** MP-14 — عرض منتهٍ أو منشأة معلَّقة (`?supplier=`، `?offer=`). */
export default function MarketUnavailablePage() {
  return (
    <Suspense fallback={null}>
      <UnavailableClient />
    </Suspense>
  );
}
