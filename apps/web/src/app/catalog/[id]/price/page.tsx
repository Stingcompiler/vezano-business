import { PriceClient } from "@/features/catalog/price-client";

/** CAT-04 — سعر صنف وتاريخ تغييره (05-D2 ready · 38-D30 validation_error/permission_denied/success). */
export default async function ItemPricePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PriceClient itemId={id} />;
}
