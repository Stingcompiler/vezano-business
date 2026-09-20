import { Suspense } from "react";

import { GrowPromoteClient } from "@/features/market/grow-promote-client";

/** GROW-03 — M4 خلف علم `market_m4`؛ بلا العلم تُعرض بحالة `phase_locked`. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <GrowPromoteClient />
    </Suspense>
  );
}
