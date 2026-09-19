import { Suspense } from "react";

import { ShareClient } from "@/features/market/share-client";

/** MP-07 — مشاركة رابط ودعوة منشأة (`?offer=` أو `?supplier=`). */
export default function MarketSharePage() {
  return (
    <Suspense fallback={null}>
      <ShareClient />
    </Suspense>
  );
}
