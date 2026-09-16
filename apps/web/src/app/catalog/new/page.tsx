import { Suspense } from "react";

import { ItemPageClient } from "@/features/catalog/item-page-client";

/** CAT-02 — إنشاء صنف وبطاقته (31-D23 ready/validation_error/saving/success). */
export default function NewItemPage() {
  return (
    <Suspense fallback={null}>
      <ItemPageClient />
    </Suspense>
  );
}
