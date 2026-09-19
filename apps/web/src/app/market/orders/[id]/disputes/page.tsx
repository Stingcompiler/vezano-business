import { Suspense } from "react";

import { DisputesClient } from "@/features/market/disputes-client";

/** ORD-12 — خلاف وأدلته وتطور حالته (`?d=` خلاف بعينه). */
export default async function MarketDisputesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <DisputesClient id={id} />
    </Suspense>
  );
}
