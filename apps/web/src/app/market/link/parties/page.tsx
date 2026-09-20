import { Suspense } from "react";

import { LinkPartiesClient } from "@/features/market/link-parties-client";

/** LINK-01 — M3 خلف علم `market_m3`؛ بلا العلم تُعرض بحالة `phase_locked`. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <LinkPartiesClient />
    </Suspense>
  );
}
