import { Suspense } from "react";

import { RenewalsClient } from "@/features/market/renewals-client";

/** MP-13 — تجديد تأكيد سعر وتوفر (`?o=` عرض بعينه). */
export default function MarketRenewalsPage() {
  return (
    <Suspense fallback={null}>
      <RenewalsClient />
    </Suspense>
  );
}
