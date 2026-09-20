import { Suspense } from "react";

import { LinkItemsClient } from "@/features/market/link-items-client";

/** LINK-02 — M3 خلف علم `market_m3`؛ بلا العلم تُعرض بحالة `phase_locked`. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <LinkItemsClient />
    </Suspense>
  );
}
