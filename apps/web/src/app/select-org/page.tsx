import { Suspense } from "react";

import { SelectOrgClient } from "./select-org-client";

/** ACC-03 — اختيار المنشأة والفرع (28-D21 ready/permission_denied · 34-D26 loading/empty/offline/stale). */
export default function SelectOrgPage() {
  return (
    <Suspense fallback={null}>
      <SelectOrgClient />
    </Suspense>
  );
}
