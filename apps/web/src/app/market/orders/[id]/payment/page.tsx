import { Suspense } from "react";

import { PaymentClient } from "@/features/market/payment-client";

/** ORD-13 — إثبات دفع ومتابعة المطابقة. */
export default async function MarketPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <PaymentClient id={id} />
    </Suspense>
  );
}
