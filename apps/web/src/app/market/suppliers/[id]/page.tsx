import { Suspense } from "react";

import { SupplierClient } from "@/features/market/supplier-client";

/** MP-03 — ملف منشأة منشور (رابط عام). */
export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <SupplierClient id={id} />
    </Suspense>
  );
}
