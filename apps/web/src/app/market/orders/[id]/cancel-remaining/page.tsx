import { Suspense } from "react";

import { CancelRemainingClient } from "@/features/market/cancel-remaining-client";

/** ORD-10 — إلغاء المتبقّي. */
export default async function MarketCancelRemainingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CancelRemainingClient id={id} />
    </Suspense>
  );
}
