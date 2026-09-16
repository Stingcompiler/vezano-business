import { Suspense } from "react";

import { ItemPageClient } from "@/features/catalog/item-page-client";

/** CAT-02 — بطاقة صنف قائم: النموذج نفسه معبّأً من `catalog/items/{id}` مع الصورة والوحدات. */
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ItemPageClient itemId={id} />
    </Suspense>
  );
}
