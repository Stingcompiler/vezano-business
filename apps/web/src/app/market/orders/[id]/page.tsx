import { Suspense } from "react";

import { OrderDetailClient } from "@/features/market/order-detail-client";

/** ORD-05 — تفاصيل الطلب وسجل الإصدارات (لطرفيه). */
export default async function MarketOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <OrderDetailClient id={id} />
    </Suspense>
  );
}
