import { Suspense } from "react";

import { SearchClient } from "./search-client";

/** HOME-03 — بحث عام وإشعارات سريعة (31-D23: ready/loading/empty/permission_denied/offline · M/390 · D/1920). */
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchClient />
    </Suspense>
  );
}
