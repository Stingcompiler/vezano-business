import { Suspense } from "react";

import { RestoreClient } from "@/features/market/restore-client";

/** ORD-15 — استعادة طلب بعد فقد خادمي. */
export default async function MarketRestorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <RestoreClient id={id} />
    </Suspense>
  );
}
