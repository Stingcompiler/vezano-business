import { Suspense } from "react";

import { SearchClient } from "@/features/market/search-client";

/** MP-04 — نتائج بحث المنتجات والمقارنة (`?q=`). */
export default function MarketSearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchClient />
    </Suspense>
  );
}
