import { Suspense } from "react";

import { LinkReturnsClient } from "@/features/market/link-returns-client";

/** LINK-05 — M3 خلف علم `market_m3`؛ بلا العلم تُعرض بحالة `phase_locked`. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <LinkReturnsClient />
    </Suspense>
  );
}
