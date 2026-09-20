import { Suspense } from "react";

import { LinkReceiptsClient } from "@/features/market/link-receipts-client";

/** LINK-03 — M3 خلف علم `market_m3`؛ بلا العلم تُعرض بحالة `phase_locked`. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <LinkReceiptsClient />
    </Suspense>
  );
}
