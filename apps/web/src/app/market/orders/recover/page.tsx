import { Suspense } from "react";

import { RecoverClient } from "@/features/market/recover-client";

/** ORD-14 — تعارض نسخة أو ردٌّ مفقود (`?op=` مفتاح العملية). */
export default function MarketRecoverPage() {
  return (
    <Suspense fallback={null}>
      <RecoverClient />
    </Suspense>
  );
}
