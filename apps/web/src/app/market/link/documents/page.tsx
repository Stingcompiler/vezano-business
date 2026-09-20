import { Suspense } from "react";

import { LinkDocumentsClient } from "@/features/market/link-documents-client";

/** LINK-04 — M3 خلف علم `market_m3`؛ بلا العلم تُعرض بحالة `phase_locked`. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <LinkDocumentsClient />
    </Suspense>
  );
}
