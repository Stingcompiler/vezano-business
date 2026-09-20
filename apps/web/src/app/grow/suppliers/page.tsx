import { Suspense } from "react";

import { GrowSuppliersClient } from "@/features/market/grow-suppliers-client";

/** GROW-02 — M4 خلف علم `market_m4`؛ بلا العلم تُعرض بحالة `phase_locked`. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <GrowSuppliersClient />
    </Suspense>
  );
}
