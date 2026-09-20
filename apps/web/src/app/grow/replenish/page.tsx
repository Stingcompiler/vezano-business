import { Suspense } from "react";

import { GrowReplenishClient } from "@/features/market/grow-replenish-client";

/** GROW-01 — M4 خلف علم `market_m4`؛ بلا العلم تُعرض بحالة `phase_locked`. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <GrowReplenishClient />
    </Suspense>
  );
}
