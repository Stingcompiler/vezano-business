import { Suspense } from "react";

import { CatalogClient } from "./catalog-client";

/** CAT-01 — قائمة الأصناف والبحث (05-D2 ready · 38-D30 loading/empty/offline/stale). */
export default function CatalogPage() {
  return (
    <Suspense fallback={null}>
      <CatalogClient />
    </Suspense>
  );
}
