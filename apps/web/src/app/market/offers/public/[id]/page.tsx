import { Suspense } from "react";

import { OfferDetailClient } from "@/features/market/offer-detail-client";

/** MP-05 — تفاصيل عرض (رابط عام؛ الخاص بحساب مخوَّل). */
export default async function PublicOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <OfferDetailClient id={id} />
    </Suspense>
  );
}
